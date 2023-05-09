const { Client, MessageMedia, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const { body, validationResult } = require("express-validator");
const socketIO = require("socket.io");
const qrcode = require("qrcode");
const http = require("http");
const fs = require("fs");
const { phoneNumberFormatter } = require("./helpers/formatter");
const fileUpload = require("express-fileupload");
const axios = require("axios");
const mime = require("mime-types");

const port = process.env.PORT || 8090;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(
  express.urlencoded({
    extended: true,
  })
);

/**
 * BASED ON MANY QUESTIONS
 * Actually ready mentioned on the tutorials
 *
 * Many people confused about the warning for file-upload
 * So, we just disabling the debug for simplicity.
 */
app.use(
  fileUpload({
    debug: false,
  })
);

app.get("/", (req, res) => {
  res.sendFile("index.html", {
    root: __dirname,
  });
});

const client = new Client({
  restartOnAuthFail: true,
  puppeteer: {
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process", // <- this one doesn't works in Windows
      "--disable-gpu",
    ],
  },
  authStrategy: new LocalAuth(),
});

client.on("message", (msg) => {
  if (msg.body == "!ping") {
    msg.reply("pong");
  } else if (msg.body == "good morning") {
    msg.reply("selamat pagi");
  } else if (msg.body == "!groups") {
    client.getChats().then((chats) => {
      const groups = chats.filter((chat) => chat.isGroup);

      if (groups.length == 0) {
        msg.reply("You have no group yet.");
      } else {
        let replyMsg = "*YOUR GROUPS*\n\n";
        groups.forEach((group, i) => {
          replyMsg += `ID: ${group.id._serialized}\nName: ${group.name}\n\n`;
        });
        replyMsg +=
          "_You can use the group id to send a message to the group._";
        msg.reply(replyMsg);
      }
    });
  }

  // NOTE!
  // UNCOMMENT THE SCRIPT BELOW IF YOU WANT TO SAVE THE MESSAGE MEDIA FILES
  // Downloading media
  // if (msg.hasMedia) {
  //   msg.downloadMedia().then(media => {
  //     // To better understanding
  //     // Please look at the console what data we get
  //     console.log(media);

  //     if (media) {
  //       // The folder to store: change as you want!
  //       // Create if not exists
  //       const mediaPath = './downloaded-media/';

  //       if (!fs.existsSync(mediaPath)) {
  //         fs.mkdirSync(mediaPath);
  //       }

  //       // Get the file extension by mime-type
  //       const extension = mime.extension(media.mimetype);

  //       // Filename: change as you want!
  //       // I will use the time for this example
  //       // Why not use media.filename? Because the value is not certain exists
  //       const filename = new Date().getTime();

  //       const fullFilename = mediaPath + filename + '.' + extension;

  //       // Save to file
  //       try {
  //         fs.writeFileSync(fullFilename, media.data, { encoding: 'base64' });
  //         console.log('File downloaded successfully!', fullFilename);
  //       } catch (err) {
  //         console.log('Failed to save the file:', err);
  //       }
  //     }
  //   });
  // }
});

client.initialize();
//client message

// Socket IO
io.on("connection", function (socket) {
  socket.emit("message", "Connecting...");
  let data = "waiting...";
  client.on("qr", (qr) => {
    console.log("QR RECEIVED", qr);
    data = qr;
    qrcode.toDataURL(qr, (err, url) => {
      socket.emit("qr", url);
      socket.emit("message", "QR Code received, scan please!");
    });
  });

  client.on("ready", () => {
    socket.emit("ready", "Whatsapp is ready!");
    socket.emit("message", "🚀 Whatsapp is ready!");
    data = "whatsapp ready";
    pendingMessage();
  });

  client.on("authenticated", () => {
    socket.emit("authenticated", "Whatsapp is authenticated!");
    socket.emit("message", "🔐 Whatsapp is authenticated!");
    console.log("AUTHENTICATED");
    data = "whatsapp authenticated";
  });

  client.on("auth_failure", function (session) {
    socket.emit("message", "Auth failure, restarting...");
  });

  client.on("disconnected", (reason) => {
    socket.emit("message", "Whatsapp is disconnected!");
    client.destroy();
    client.initialize();
  });
  app.get("/auth", async (req, res) => {
    res.status(200).send({
      auth: data,
    });
  });
});

const checkRegisteredNumber = async function (number) {
  const isRegistered = await client.isRegisteredUser(number);
  return isRegistered;
};

// Send message
app.post(
  "/send-message",
  [body("number").notEmpty(), body("message").notEmpty()],
  async (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped(),
      });
    }

    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;

    const isRegisteredNumber = await checkRegisteredNumber(number);

    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: "The number is not registered",
      });
    }

    client
      .sendMessage(number, message)
      .then((response) => {
        res.status(200).json({
          status: true,
          response: response,
        });
      })
      .catch((err) => {
        res.status(500).json({
          status: false,
          response: err,
        });
      });
  }
);
// Send media
app.post("/send-media", async (req, res) => {
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  // const media = MessageMedia.fromFilePath('./image-example.png');
  // const file = req.files.file;
  // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  let mimetype;
  const attachment = await axios
    .get(fileUrl, {
      responseType: "arraybuffer",
    })
    .then((response) => {
      mimetype = response.headers["content-type"];
      return response.data.toString("base64");
    });

  const media = new MessageMedia(mimetype, attachment, "Media");

  client
    .sendMessage(number, media, {
      caption: caption,
    })
    .then((response) => {
      res.status(200).json({
        status: true,
        response: response,
      });
    })
    .catch((err) => {
      res.status(500).json({
        status: false,
        response: err,
      });
    });
});

const findGroupByName = async function (name) {
  const group = await client.getChats().then((chats) => {
    return chats.find(
      (chat) => chat.isGroup && chat.name.toLowerCase() == name.toLowerCase()
    );
  });
  return group;
};

// Send message to group
// You can use chatID or group name, yea!
app.post(
  "/send-group-message",
  [
    body("id").custom((value, { req }) => {
      if (!value && !req.body.name) {
        throw new Error("Invalid value, you can use `id` or `name`");
      }
      return true;
    }),
    body("message").notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped(),
      });
    }

    let chatId = req.body.id;
    const groupName = req.body.name;
    const message = req.body.message;

    // Find the group by name
    if (!chatId) {
      const group = await findGroupByName(groupName);
      if (!group) {
        return res.status(422).json({
          status: false,
          message: "No group found with name: " + groupName,
        });
      }
      chatId = group.id._serialized;
    }

    client
      .sendMessage(chatId, message)
      .then((response) => {
        res.status(200).json({
          status: true,
          response: response,
        });
      })
      .catch((err) => {
        res.status(500).json({
          status: false,
          response: err,
        });
      });
  }
);

// Clearing message on spesific chat
app.post("/clear-message", [body("number").notEmpty()], async (req, res) => {
  const errors = validationResult(req).formatWith(({ msg }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped(),
    });
  }

  const number = phoneNumberFormatter(req.body.number);

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: "The number is not registered",
    });
  }

  const chat = await client.getChatById(number);

  chat
    .clearMessages()
    .then((status) => {
      res.status(200).json({
        status: true,
        response: status,
      });
    })
    .catch((err) => {
      res.status(500).json({
        status: false,
        response: err,
      });
    });
});

// client.on("message", (message) => {
//   console.log(message.body);
// });

// const pendingMessage = async () =>
//   await axios
//     .get("http://8a73085df21a.sn.mynetname.net:8080/api/send_out")
//     .then((resp) => {
//       const data = resp.data;
//       data.map((msg) => {
//         // console.log("ID: %j", msg.ID);
//         // console.log("NUMBER: %j", msg.PHONE);
//         // console.log("MESSAGE: %j", msg.MESSAGE);
//         // console.log("waiting for 5 seconds..");
//         // send message
//         let payload = {
//           number: msg.PHONE,
//           message: msg.MESSAGE,
//         };
//         axios
//           .post(
//             "http://8a73085df21a.sn.mynetname.net:8090/send-message",
//             payload
//           )
//           .then(function (response) {
//             console.log(response.data);
//             if (msg.ID) {
//               updateFlag(msg.ID, "sent");
//             }
//           })
//           .catch(function (error) {
//             if (msg.ID) {
//               updateFlag(msg.ID, "sent");
//             }
//           });
//         //sendMessagePending(payload);
//       });
//     });
function pendingMessage() {
  setInterval(async () => {
    const datalist = await axios
      .get("http://8a73085df21a.sn.mynetname.net:8080/api/send_out")
      .then(function (response) {
        const dataFetch = response.data;
        const listSendOut = [];
        for (let i = 0; i < dataFetch.length; i++) {
          const data = {
            number: dataFetch[i].PHONE,
            message: dataFetch[i].MESSAGE,
          };
          const idList = dataFetch[i].ID;
          const noids = i;
          post(data, idList, noids);
        }
      });
  }, 5000);
}

// let payload = {
//   number: "08562913396",
//   message: "hello",
// };
async function post(payload, id, noids) {
  const data = await axios
    .post("http://8a73085df21a.sn.mynetname.net:8090/send-message", payload)
    .then(function (response) {
      if (id) {
        updateFlag(id, "sent");
        console.log("sent" + id + noids);
      }
    })
    .catch(function (data) {
      if (id) {
        updateFlag(id, "notsent");
        console.log("notsent");
      }
      console.log("not sent" + noids);
    });
}
async function updateFlag(id, status) {
  const statusMessage = status;
  const idMessage = id;
  data = await axios
    .put(
      `http://8a73085df21a.sn.mynetname.net:8080/api/send_out/${idMessage}`,
      {
        status: statusMessage,
      }
    )
    .catch(function (error) {
      console.error(error);
    });
}
server.listen(port, "192.168.1.17");
