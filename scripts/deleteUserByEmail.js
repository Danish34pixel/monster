/**
 * UTILITY SCRIPT: Delete a user/purchaser/stockist by email for testing.
 * Usage: node scripts/deleteUserByEmail.js <email>
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Stockist = require('../models/Stockist');
const Purchaser = require('../models/Purchaser');
const Staff = require('../models/Staff');

async function run() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/deleteUserByEmail.js <email>');
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/meditrap';

  try {
    await mongoose.connect(uri);
    console.log(`Connected to MongoDB. Searching for ${normalizedEmail}...`);

    const results = await Promise.all([
      User.deleteOne({ email: normalizedEmail }),
      Stockist.deleteOne({ email: normalizedEmail }),
      Purchaser.deleteOne({ email: normalizedEmail }),
      Staff.deleteOne({ email: normalizedEmail }),
    ]);

    const deletedCount = results.reduce((acc, res) => acc + res.deletedCount, 0);

    if (deletedCount > 0) {
      console.log(`Successfully deleted ${deletedCount} record(s) matching ${normalizedEmail}.`);
    } else {
      console.log(`No records found for ${normalizedEmail}.`);
    }

  } catch (err) {
    console.error('Deletion failed:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

run();
