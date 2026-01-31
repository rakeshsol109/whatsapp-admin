const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  from: String,
  to: String,
  text: String,

  media: {
    type: { type: String }, // image | audio | document
    id: String,             // WhatsApp Media ID
    mime: String,           // File Type (image/jpeg etc)
    url: String             // 🟢 NEW: File Path for Frontend (/media/filename.jpg)
  },

  direction: String, // in | out
  status: { type: String, default: "sent" }, // sent | delivered | seen
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Message", MessageSchema);
