const mongoose = require("mongoose");

const dialListSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  numbers: [
    { phoneNumber: String, status: { type: String, default: "pending" } },
  ], // Array of numbers
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("DialList", dialListSchema);
