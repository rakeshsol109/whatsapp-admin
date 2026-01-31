const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const multer = require("multer"); // 🟢 New
const FormData = require("form-data"); // 🟢 New

const Message = require("./models/Message");

const app = express();
const PORT = process.env.PORT || 10000;

// 🟢 Setup Uploads
const upload = multer({ dest: "uploads/" });

// 🟢 Setup Media Folder
const MEDIA_DIR = path.join(__dirname, "public", "media");
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET || "supersecret",
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

app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.loggedIn = true;
    return res.redirect("/");
  }
  res.send("❌ Invalid Login");
});

// 🟢 Helper: Download Media
async function downloadMedia(mediaId, mimeType) {
  try {
    const urlRes = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${process.env.TOKEN}` } }
    );
    const mediaUrl = urlRes.data.url;

    let ext = mimeType.split("/")[1];
    if(ext === "plain") ext = "txt";
    if(ext.includes("word")) ext = "docx";
    
    const fileName = `${mediaId}.${ext}`;
    const filePath = path.join(MEDIA_DIR, fileName);

    const writer = fs.createWriteStream(filePath);
    const response = await axios({
      url: mediaUrl,
      method: "GET",
      responseType: "stream",
      headers: { Authorization: `Bearer ${process.env.TOKEN}` },
    });
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve(`/media/${fileName}`));
      writer.on("error", reject);
    });
  } catch (error) {
    console.error("❌ Download Error:", error.message);
    return null;
  }
}

// 🔹 Webhook
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  const value = req.body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  const status = value?.statuses?.[0];

  if (msg) {
    let mediaData = null;
    let textBody = msg.text?.body || "";

    if (["image", "document", "audio", "video"].includes(msg.type)) {
      const mediaObj = msg[msg.type];
      const savedPath = await downloadMedia(mediaObj.id, mediaObj.mime_type);
      if (savedPath) {
        mediaData = { type: msg.type, id: mediaObj.id, mime: mediaObj.mime_type, url: savedPath };
        if (!textBody && mediaObj.caption) textBody = mediaObj.caption;
      }
    }

    try {
      await Message.create({
        from: msg.from,
        text: textBody,
        media: mediaData,
        direction: "in",
        status: "seen"
      });
    } catch (e) { console.error(e); }
  }

  if (status) {
    await Message.updateMany({ to: status.recipient_id }, { status: status.status });
  }
  res.sendStatus(200);
});

// 🔹 Routes
app.get("/chats", auth, async (req, res) => {
  const chats = await Message.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$from", last: { $first: "$text" } } }
  ]);
  res.json(chats);
});

app.get("/messages/:number", auth, async (req, res) => {
  const num = req.params.number;
  await Message.updateMany({ from: num, direction: "in" }, { status: "seen" });
  const msgs = await Message.find({ $or: [{ from: num }, { to: num }] }).sort("createdAt");
  res.json(msgs);
});

app.post("/reply", auth, async (req, res) => {
  const { to, message } = req.body;
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: message } },
      { headers: { Authorization: `Bearer ${process.env.TOKEN}`, "Content-Type": "application/json" } }
    );
    await Message.create({ to, text: message, direction: "out", status: "sent" });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🟢 NEW: Send Media Route
app.post("/send-media", auth, upload.single("file"), async (req, res) => {
  const { to, caption } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file" });

  try {
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("file", fs.createReadStream(file.path), {
      filename: file.originalname, contentType: file.mimetype
    });

    const uploadRes = await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/media`,
      formData,
      { headers: { Authorization: `Bearer ${process.env.TOKEN}`, ...formData.getHeaders() } }
    );

    const mediaId = uploadRes.data.id;

    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "image", image: { id: mediaId, caption: caption || "" } },
      { headers: { Authorization: `Bearer ${process.env.TOKEN}`, "Content-Type": "application/json" } }
    );

    await Message.create({
      to, text: caption || "📷 Sent Photo", media: { type: "image", id: mediaId, url: "" },
      direction: "out", status: "sent"
    });

    fs.unlinkSync(file.path);
    res.json({ success: true });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed" });
  }
});

app.get("/", auth, (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

app.listen(PORT, () => console.log("🔥 Server running on port", PORT));
