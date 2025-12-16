const mongoose = require("mongoose");
const { User } = require("./db");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const res = await User.updateMany(
    { emailVerified: true },
    { $set: { verified: true } }
  );

  console.log("✅ Fixed users:", res.modifiedCount);
  process.exit();
})();
