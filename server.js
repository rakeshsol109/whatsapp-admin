const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");
const session = require("express-session");
const path = require("path");

const Message = require("./models/Message");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET,
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

// 🔐 Login
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
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
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === process.env.VERIFY_TOKEN
  ) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// 🔹 Webhook receive (text + media + status)
app.post("/webhook", async (req, res) => {
  const value = req.body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  const status = value?.statuses?.[0];

  if (msg) {
    let media = null;

    if (msg.image) media = { type: "image", id: msg.image.id, mime: msg.image.mime_type };
    if (msg.document) media = { type: "document", id: msg.document.id, mime: msg.document.mime_type };
    if (msg.audio) media = { type: "audio", id: msg.audio.id, mime: msg.audio.mime_type };

    await Message.create({
      from: msg.from,
      text: msg.text?.body,
      media,
      direction: "in",
      status: "seen"
    });
  }

  if (status) {
    await Message.updateMany(
      { to: status.recipient_id },
      { status: status.status }
    );
  }

  res.sendStatus(200);
});

// 🔹 Chat list
app.get("/chats", auth, async (req, res) => {
  const chats = await Message.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$from", last: { $first: "$text" } } }
  ]);
  res.json(chats);
});

// 🔹 Messages + Seen ✓✓
app.get("/messages/:number", auth, async (req, res) => {
  const num = req.params.number;

  await Message.updateMany(
    { from: num, direction: "in" },
    { status: "seen" }
  );

  const msgs = await Message.find({
    $or: [{ from: num }, { to: num }]
  }).sort("createdAt");

  res.json(msgs);
});

// 🔹 Send reply
app.post("/reply", auth, async (req, res) => {
  const { to, message } = req.body;

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
app.get("/", auth, (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.listen(PORT, () => {
  console.log("🔥 WhatsApp Admin LIVE on port", PORT);
});
