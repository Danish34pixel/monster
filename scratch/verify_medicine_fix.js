const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const envPath = fs.existsSync('.env') ? '.env' : 'config.env';
dotenv.config({ path: envPath });

async function run() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const Medicine = require('../models/Medicine');
    const Stockist = require('../models/Stockist');

    const stockistId = '69deb0e0f1399f5fca81d735';
    const medName = 'Verification Medicine ' + Date.now();

    // 1. Create Medicine
    const med = await Medicine.create({
      name: medName,
      genericName: 'Verify Generic',
      price: 99
    });
    console.log('✅ Created Medicine:', med.name, med._id);

    // 2. Link to Stockist
    const stockistUpdate = await Stockist.findByIdAndUpdate(
      stockistId,
      { $addToSet: { medicines: med.name } },
      { new: true }
    );
    
    if (stockistUpdate && stockistUpdate.medicines.includes(medName)) {
      console.log('✅ Stockist Medicines updated successfully');
    } else {
      console.error('❌ Failed to update Stockist medicines');
    }

    // 3. Check db_debug.txt
    if (fs.existsSync('db_debug.txt')) {
      const logs = fs.readFileSync('db_debug.txt', 'utf8');
      if (logs.includes(med.name)) {
        console.log('✅ Log entry found in db_debug.txt');
      } else {
        console.error('❌ Log entry NOT found in db_debug.txt');
      }
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
