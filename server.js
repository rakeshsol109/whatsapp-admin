const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");
const session = require("express-session");
const path = require("path");
const fs = require("fs");

const Message = require("./models/Message");

const app = express();
const PORT = process.env.PORT || 10000;

// 🟢 1. Check Media Folder
const MEDIA_DIR = path.join(__dirname, "public", "media");
if (!fs.existsSync(MEDIA_DIR)) {
  console.log("📁 Creating media folder...");
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); // Important for serving images

app.use(session({
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: false
}));

// 🔹 MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ Mongo Error", err));

// 🔐 Login Routes (Shortened)
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.loggedIn = true;
    return res.redirect("/");
  }
  res.send("❌ Invalid Login");
});
function auth(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect("/login");
}

// 🟢 Helper: Get Extension from Mime
function getExtension(mime) {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "audio/ogg": return "ogg"; // WhatsApp audio usually ogg
    case "audio/mpeg": return "mp3";
    case "application/pdf": return "pdf";
    case "application/msword": return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
    case "video/mp4": return "mp4";
    default: return "bin";
  }
}

// 🟢 Helper: Download Media
async function downloadMedia(mediaId, mimeType) {
  try {
    console.log(`⏳ Requesting URL for ID: ${mediaId}`);
    
    // 1. Get Download URL
    const urlRes = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`, // Version 19 is stable
      { headers: { Authorization: `Bearer ${process.env.TOKEN}` } }
    );
    
    const mediaUrl = urlRes.data.url;
    console.log(`🔗 Got URL: ${mediaUrl}`);

    // 2. Setup File Path
    const ext = getExtension(mimeType);
    const fileName = `${mediaId}.${ext}`;
    const filePath = path.join(MEDIA_DIR, fileName);
    const publicPath = `/media/${fileName}`; // Path for frontend

    // 3. Download Stream
    const writer = fs.createWriteStream(filePath);
    const response = await axios({
      url: mediaUrl,
      method: "GET",
      responseType: "stream",
      headers: { Authorization: `Bearer ${process.env.TOKEN}` },
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        console.log(`✅ File Saved: ${filePath}`);
        resolve(publicPath);
      });
      writer.on("error", (err) => {
        console.error("❌ Write Error:", err);
        reject(err);
      });
    });

  } catch (error) {
    console.error("❌ Download Failed:", error.response ? error.response.data : error.message);
    return null;
  }
}

// 🔹 Webhook Verify
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// 🔹 Webhook Receive
app.post("/webhook", async (req, res) => {
  // console.log("📨 Webhook Hit!"); // Debug log
  const value = req.body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  const status = value?.statuses?.[0];

  if (msg) {
    console.log(`📩 New Message from ${msg.from} Type: ${msg.type}`);
    
    let mediaData = null;
    let textBody = msg.text?.body || "";

    // Handle Media
    if (["image", "document", "audio", "video", "sticker"].includes(msg.type)) {
      const mediaObj = msg[msg.type];
      console.log(`📎 Found Media: ${msg.type}, ID: ${mediaObj.id}`);

      // Download
      const savedPath = await downloadMedia(mediaObj.id, mediaObj.mime_type);
      
      if (savedPath) {
        mediaData = {
          type: msg.type,
          id: mediaObj.id,
          mime: mediaObj.mime_type,
          url: savedPath // 🟢 Saving the path!
        };
        // Use caption if text is empty
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
      console.log("💾 Message Saved to DB");
    } catch (dbError) {
      console.error("❌ DB Save Error:", dbError);
    }
  }

  if (status) {
    await Message.updateMany({ to: status.recipient_id }, { status: status.status });
  }

  res.sendStatus(200);
});

// 🔹 API Routes
app.get("/chats", auth, async (req, res) => {
  const chats = await Message.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$from", last: { $first: "$text" }, type: { $first: "$media.type" } } }
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
  } catch (e) {
    console.error("❌ Reply Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// UI
app.get("/", auth, (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

app.listen(PORT, () => {
  console.log("🔥 Server running on port", PORT);
  console.log("📂 Media path checked:", MEDIA_DIR);
});
