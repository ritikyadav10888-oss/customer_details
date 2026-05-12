/**
 * Upload the day-wise master CSV to the live Google Sheet.
 *
 * Source CSV : MASTER_BOOKING_SHEET_DAY_WISE.csv (produced by
 *              day_wise_extractor.py)
 * Target     : Spreadsheet "Master Data" -> tab "Master Data"
 *              (https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit)
 *
 * Columns A..M:
 *   Booking ID | Date | Customer Name | Phone Number | Booking Type |
 *   Platform Name | Venue | Sports | Court Numbers | Start Time |
 *   End Time | Total Hours | Price
 *
 * Behaviour:
 *   1. Authenticate with the existing service account JSON.
 *   2. Clear the existing range A2:M (preserves the header row).
 *   3. Append the new rows in 2,000-row batches using RAW input so Google
 *      Sheets does not reinterpret times (e.g. "10PM" / "22:00") as serial
 *      fractions like 0.9166666667.
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = '1Pxe23SgQoVsITyMi1_AibtLnJ9Hut9KDxoM9d6yvrMc';
const SHEET_NAME = 'Master Data';
const SERVICE_ACCOUNT_FILE = path.join(
    process.cwd(),
    'semiotic-sylph-490711-d9-cc0a28009e2c.json'
);
const CSV_PATH = path.join(process.cwd(), 'MASTER_BOOKING_SHEET_DAY_WISE.csv');
const BATCH_SIZE = 2000;

function parseCsv(content) {
    // Minimal CSV parser supporting quoted fields with embedded commas / quotes.
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
        const c = content[i];
        if (inQuotes) {
            if (c === '"') {
                if (content[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && content[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += c;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

async function uploadDayWise() {
    console.log('Reading day-wise master CSV...');
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`File not found: ${CSV_PATH}`);
        process.exit(1);
    }
    if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
        console.error(`Service account JSON not found: ${SERVICE_ACCOUNT_FILE}`);
        process.exit(1);
    }

    const content = fs.readFileSync(CSV_PATH, 'utf8');
    const parsed = parseCsv(content);
    if (parsed.length < 2) {
        console.error('CSV appears to be empty.');
        process.exit(1);
    }

    const headerCols = parsed[0];
    const rows = parsed.slice(1).filter((r) => r.some((v) => String(v).trim() !== ''));
    console.log(`   Header  : ${headerCols.length} columns`);
    console.log(`   Rows    : ${rows.length.toLocaleString()}`);

    if (headerCols.length !== 13) {
        console.warn(`!! Expected 13 columns, got ${headerCols.length}. Continuing anyway.`);
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: SERVICE_ACCOUNT_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Make sure the sheet exists (and grab its id for resizing).
    console.log('Verifying spreadsheet & tab...');
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const tab = meta.data.sheets.find(
        (s) => s.properties.title === SHEET_NAME
    );
    if (!tab) {
        console.error(`Tab "${SHEET_NAME}" not found in spreadsheet. Available tabs:`);
        meta.data.sheets.forEach((s) => console.error(`   - ${s.properties.title}`));
        process.exit(1);
    }
    console.log(`   Title   : ${meta.data.properties.title}`);
    console.log(`   Tab     : ${SHEET_NAME} (id=${tab.properties.sheetId})`);

    // 1. Refresh the header row so the column order can't drift.
    console.log('Refreshing header row...');
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:M1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headerCols] },
    });

    // 2. Clear existing data below the header.
    console.log('Clearing existing data range A2:M...');
    await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:M`,
    });

    // 3. Append in chunks.
    console.log('Uploading rows in batches...');
    let uploaded = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2`,
            // RAW: keep every cell exactly as in the CSV (text). USER_ENTERED
            // parses "10PM" / partial times as clock values → 0.9166… display.
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: chunk },
        });
        uploaded += chunk.length;
        const pct = ((uploaded / rows.length) * 100).toFixed(1);
        console.log(`   ${uploaded.toLocaleString()}/${rows.length.toLocaleString()} (${pct}%)`);
    }

    console.log('\nSUCCESS!');
    console.log(`   Uploaded ${uploaded.toLocaleString()} bookings to "${SHEET_NAME}".`);
    console.log(
        `   View: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${tab.properties.sheetId}`
    );
}

uploadDayWise().catch((err) => {
    console.error('Upload failed:', err.message);
    if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
    process.exit(1);
});
