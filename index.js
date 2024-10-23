"use strict"; // since I hate not using semicolons

/**
 * Required Imports
 *  - dotenv: .env support
 *  - fs: file system support (for reading ./commands)
 *  - mongoose: mongoDB client
 *  - discord.js: discord (duh)
 *  - schedule: for running the cron jobs
 *  - standup.model: the model for the standup stored in mongo
 */
require("dotenv").config();
const fs = require("fs");
const mongoose = require("mongoose");
const { Client, MessageEmbed, Collection } = require("discord.js");
const schedule = require("node-schedule");
const standupModel = require("./models/standup.model");

const PREFIX = "!";

const standupIntroMessage = new MessageEmbed()
  .setColor("#ff9900")
  .setTitle("Daily Standup")
  .setDescription(
    "Este é o canal de texto recém-gerado usado para reuniões diárias do time de Engenharia + SRE!"
  )
  .addFields(
    {
      name: "Introdução",
      value: `Oi! Eu sou um BOT desenvolvido pelo Time de Engenharia e facilitarei suas reuniões diárias a partir de agora.\nPara ver todos os comandos disponíveis, digite \`${PREFIX}help\`.`,
    },
    {
      name: "Como eu funciono?",
      value: `Todos os dias às \`09:00 AM \` e \`14:00 PM \`, eu vou te avisar por DM caso ainda não tenha preenchido seu relatório de atividades. Em seguida, salvarei a resposta na minha *câmara especial secreta de dados* e apresentarei a resposta no canal de texto \`#engenharia\`.`,
    },
    {
      name: "Começando",
      value: `*Atualmente*, não há membros no standup! Para adicionar um membro, tente \`${PREFIX}am <User>\`.`,
    }
  )
  .setFooter(
    "https://developers.totvs.com/svg/selo-totvs-2.svg"
  )
  .setTimestamp();

const dailyStandupSummary = new MessageEmbed()
  .setColor("#ff9900")
  .setTitle("Daily Standup")
  .setURL("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
  .setFooter(
    "https://github.com/navn-r/standup-bot",
    "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png"
  )
  .setTimestamp();

// lists .js files in commands dir
const commandFiles = fs
  .readdirSync("./commands")
  .filter((file) => file.endsWith(".js"));

// init bot client with a collection of commands
const bot = new Client();
bot.commands = new Collection();

// Imports the command file + adds the command to the bot commands collection
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  bot.commands.set(command.name, command);
}

// mongodb setup with mongoose
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
  })
  .catch((e) => console.error(e));

mongoose.connection.once("open", () => console.log("mongoDB connected"));

bot.once("ready", () => console.log("Discord Bot Ready"));

// when a user enters a command
bot.on("message", async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  if (!bot.commands.has(commandName)) return;

  if (message.mentions.users.has(bot.user.id))
    return message.channel.send(":robot:");

  const command = bot.commands.get(commandName);

  if (command.guildOnly && message.channel.type === "dm") {
    return message.channel.send("Hmm, that command cannot be used in a dm!");
  }

  try {
    await command.execute(message, args);
  } catch (error) {
    console.error(error);
    message.channel.send(`Error 8008135: Something went wrong!`);
  }
});

bot.on("guildCreate", async (guild) => {
  // creates the text channel
  const channel = await guild.channels.create("daily-standups", {
    type: "text",
    topic: "Scrum Standup Meeting Channel",
  });

  // creates the database model
  const newStandup = new standupModel({
    _id: guild.id,
    channelId: channel.id,
    members: [],
    responses: new Map(),
  });

  newStandup
    .save()
    .then(() => console.log("Howdy!"))
    .catch((err) => console.error(err));

  await channel.send(standupIntroMessage);
});

// delete the mongodb entry
bot.on("guildDelete", (guild) => {
  standupModel
    .findByIdAndDelete(guild.id)
    .then(() => console.log("Peace!"))
    .catch((err) => console.error(err));
});

/**
 * Cron Job: 10:30:00 AM EST - Go through each standup and output the responses to the channel
let cron = schedule.scheduleJob(
  { hour: 15, minute: 30, dayOfWeek: new schedule.Range(1, 5) },
  (time) => {
    console.log(`[${time}] - CRON JOB START`);
    standupModel
      .find()
      .then((standups) => {
        standups.forEach((standup) => {
          let memberResponses = [];
          let missingMembers = [];
          standup.members.forEach((id) => {
            if (standup.responses.has(id)) {
              memberResponses.push({
                name: `-`,
                value: `<@${id}>\n${standup.responses.get(id)}`,
              });
              standup.responses.delete(id);
            } else {
              missingMembers.push(id);
            }
          });
          let missingString = "Hooligans: ";
          if (!missingMembers.length) missingString += ":man_shrugging:";
          else missingMembers.forEach((id) => (missingString += `<@${id}> `));
          bot.channels.cache
            .get(standup.channelId)
            .send(
              new MessageEmbed(dailyStandupSummary)
                .setDescription(missingString)
                .addFields(memberResponses)
            );
          standup
            .save()
            .then(() =>
              console.log(`[${new Date()}] - ${standup._id} RESPONSES CLEARED`)
            )
            .catch((err) => console.error(err));
        });
      })
      .catch((err) => console.error(err));
  }
);
*/

/**
 * Cron Job: 09:00 AM GMT-3 - Verifica se os membros preencheram o report e envia DM caso não tenham feito
 */
let reminder9AM = schedule.scheduleJob(
  { hour: 12, minute: 0, dayOfWeek: new schedule.Range(1, 5) }, // 09h GMT-3 é 12h UTC
  () => {
    console.log(`[${new Date()}] - 09:00AM Check - CRON JOB START`);
    standupModel
      .find()
      .then((standups) => {
        standups.forEach((standup) => {
          let missingMembers = [];
          
          // Verifica quais membros não preencheram o report
          standup.members.forEach((id) => {
            if (!standup.responses.has(id)) {
              missingMembers.push(id);
            }
          });

          // Envia mensagem privada para membros que não fizeram o check-in
          missingMembers.forEach((id) => {
            bot.users.fetch(id).then((user) => {
              user.send(
                `Ei <@${id}>! Você está pronto para ter nossa reunião do Daily Engenharia + SRE agora?`
              ).catch((error) => {
                console.error(`Erro ao enviar DM para o usuário ${id}:`, error);
              });
            }).catch((error) => {
              console.error(`Erro ao buscar o usuário ${id}:`, error);
            });
          });
        });
      })
      .catch((err) => console.error(err));
  }
);

/**
 * Cron Job: 14:00 PM GMT-3 - Verifica novamente se os membros preencheram o report e envia DM caso não tenham feito
 */
let reminder2PM = schedule.scheduleJob(
  { hour: 17, minute: 0, dayOfWeek: new schedule.Range(1, 5) }, // 14h GMT-3 é 17h UTC
  () => {
    console.log(`[${new Date()}] - 14:00PM Check - CRON JOB START`);
    standupModel
      .find()
      .then((standups) => {
        standups.forEach((standup) => {
          let missingMembers = [];
          
          // Verifica quais membros não preencheram o report
          standup.members.forEach((id) => {
            if (!standup.responses.has(id)) {
              missingMembers.push(id);
            }
          });

          // Envia mensagem privada para membros que não fizeram o check-in
          missingMembers.forEach((id) => {
            bot.users.fetch(id).then((user) => {
              user.send(
                `Ei <@${id}>! Você está pronto para ter nossa reunião do Daily Engenharia + SRE agora?`
              ).catch((error) => {
                console.error(`Erro ao enviar DM para o usuário ${id}:`, error);
              });
            }).catch((error) => {
              console.error(`Erro ao buscar o usuário ${id}:`, error);
            });
          });
        });
      })
      .catch((err) => console.error(err));
  }
);

bot.login(process.env.DISCORD_TOKEN);
