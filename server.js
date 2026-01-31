const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");
const session = require("express-session");
const path = require("path");
const fs = require("fs"); // 🟢 File System added

const Message = require("./models/Message");

const app = express();
const PORT = process.env.PORT || 10000;

// 🟢 Create media folder if not exists
const MEDIA_DIR = path.join(__dirname, "public", "media");
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET || "secret_key",
  resave: false,
  saveUninitialized: false
}));

// 🔹 MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ Mongo Error", err));

// 🔐 Auth
function auth(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect("/login");
}

// 🔐 Login Routes
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.loggedIn = true;
    return res.redirect("/");
  }
  res.send("❌ Invalid Login");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// 🔹 Webhook verify
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// 🟢 Helper Function: Download Media from WhatsApp
async function downloadMedia(mediaId, mimeType) {
  try {
    // 1. Get URL from Facebook Graph API
    const urlRes = await axios.get(
      `https://graph.facebook.com/v22.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${process.env.TOKEN}` } }
    );
    const mediaUrl = urlRes.data.url;

    // Determine extension
    let ext = mimeType.split("/")[1];
    if (ext === "plain") ext = "txt"; // fix for text files
    if (ext.includes("word")) ext = "docx";
    if (ext.includes("pdf")) ext = "pdf";
    
    const fileName = `${mediaId}.${ext}`;
    const filePath = path.join(MEDIA_DIR, fileName);

    // 2. Download the binary data
    const writer = fs.createWriteStream(filePath);
    const response = await axios({
      url: mediaUrl,
      method: "GET",
      responseType: "stream",
      headers: { Authorization: `Bearer ${process.env.TOKEN}` },
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve(`/media/${fileName}`)); // Return public path
      writer.on("error", reject);
    });

  } catch (error) {
    console.error("❌ Media Download Error:", error.message);
    return null;
  }
}

// 🔹 Webhook receive (Text + Media + Status)
app.post("/webhook", async (req, res) => {
  const value = req.body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  const status = value?.statuses?.[0];

  if (msg) {
    let media = null;
    let text = msg.text?.body || "";

    // 🟢 Handle Media Types
    if (msg.type === "image" || msg.type === "document" || msg.type === "audio" || msg.type === "video" || msg.type === "sticker") {
      const mediaType = msg.type;
      const mediaObj = msg[mediaType]; // e.g. msg.image
      
      // Download File
      const publicPath = await downloadMedia(mediaObj.id, mediaObj.mime_type);
      
      media = {
        type: mediaType,
        id: mediaObj.id,
        mime: mediaObj.mime_type,
        url: publicPath, // 🟢 Saved local path
        caption: mediaObj.caption || "" // Image caption fix
      };
      
      if (!text && mediaObj.caption) text = mediaObj.caption;
    }

    await Message.create({
      from: msg.from,
      text: text,
      media: media,
      direction: "in",
      status: "seen"
    });
  }

  // Handle Status Update
  if (status) {
    await Message.updateMany({ to: status.recipient_id }, { status: status.status });
  }

  res.sendStatus(200);
});

// 🔹 Chat list
app.get("/chats", auth, async (req, res) => {
  const chats = await Message.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$from", last: { $first: "$text" }, type: { $first: "$media.type" } } }
  ]);
  res.json(chats);
});

// 🔹 Messages
app.get("/messages/:number", auth, async (req, res) => {
  const num = req.params.number;
  await Message.updateMany({ from: num, direction: "in" }, { status: "seen" });
  
  const msgs = await Message.find({ $or: [{ from: num }, { to: num }] }).sort("createdAt");
  res.json(msgs);
});

// 🔹 Send reply
app.post("/reply", auth, async (req, res) => {
  const { to, message } = req.body;
  
  // Facebook API call
  await axios.post(
    `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: message }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  await Message.create({
    to,
    text: message,
    direction: "out",
    status: "sent"
  });

  res.json({ success: true });
});

// 🔹 Admin UI
app.get("/", auth, (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

app.listen(PORT, () => console.log("🔥 WhatsApp Admin LIVE on port", PORT));
