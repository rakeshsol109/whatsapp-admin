const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  from: String,
  to: String,
  text: String,

  media: {
    type: { type: String }, // image | audio | document
    id: String,
    mime: String
  },

  direction: String, // in | out
  status: { type: String, default: "sent" }, // sent | delivered | seen
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Message", MessageSchema);
