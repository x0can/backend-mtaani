#!/usr/bin/env node

/**
 * One-time Excel inventory importer (SAFE, BATCHED)
 *
 * Usage:
 *   node inventory.js path/to/file.xlsx
 */

const fs = require("fs");
const XLSX = require("xlsx");
const mongoose = require("mongoose");

const connectDB = require("./mongo");
const { Product } = require("./index");

/* ----------------------------------------
   Helpers
----------------------------------------- */

const cleanText = (val) =>
  String(val || "")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const cleanNumber = (val) =>
  Number(String(val || "0").replace(/,/g, "").trim()) || 0;

const BATCH_SIZE = 500;

/* ----------------------------------------
   Main
----------------------------------------- */

async function run() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("❌ Usage: node inventory.js <excel-file>");
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error("❌ File not found:", filePath);
    process.exit(1);
  }

  console.log("📦 Importing inventory from:", filePath);

  await connectDB();

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });

  let carriedItemNumber = null;
  let carriedTitle = null;
  let carriedUOM = "PCS";

  let ops = [];
  let processed = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const hasAnyData = Object.values(row).some(
      (v) => String(v).trim() !== ""
    );

    if (!hasAnyData) {
      skipped++;
      continue;
    }

    const itemNumber =
      cleanText(
        row.item_number || row["item number"] || row["Item Number"]
      ) || carriedItemNumber;

    const title =
      cleanText(
        row.item_name || row["item name"] || row["Item Name"] || row.Name
      ) ||
      carriedTitle ||
      `UNNAMED ITEM ${i + 2}`;

    const uom =
      cleanText(row.UOM || row.uom) || carriedUOM || "PCS";

    carriedItemNumber = itemNumber;
    carriedTitle = title;
    carriedUOM = uom;

    const avgCost = cleanNumber(row["Av.Cost"] || row["Avg Cost"]);
    const price = cleanNumber(row.Price || row.PRICE);

    const fallbackKey = itemNumber || `${title}__${uom}`;

    ops.push({
      updateOne: {
        filter: itemNumber
          ? { "metadata.itemNumber": itemNumber }
          : { "metadata.fallbackKey": fallbackKey },

        update: {
          $set: {
            title,
            price,
            uom,
            cost: avgCost,
            stock: 0,
            metadata: {
              itemNumber,
              avgCost,
              fallbackKey,
              lastImported: new Date(),
            },
          },
        },
        upsert: true,
      },
    });

    processed++;

    // 🔥 Flush batch
    if (ops.length >= BATCH_SIZE) {
      await Product.bulkWrite(ops, { ordered: false });
      ops = [];
      process.stdout.write(`\rProcessed: ${processed}`);
    }
  }

  // Flush remaining
  if (ops.length) {
    await Product.bulkWrite(ops, { ordered: false });
  }

  console.log("\n✅ Import completed");
  console.log("Processed:", processed);
  console.log("Skipped (empty rows):", skipped);

  await mongoose.disconnect();
  process.exit(0);
}

/* ----------------------------------------
   Execute
----------------------------------------- */

run().catch((err) => {
  console.error("❌ Import failed:", err);
  process.exit(1);
});
