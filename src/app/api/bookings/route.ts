import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { Booking, dummyBookings } from '@/lib/dummyData';

const dataFilePath = path.join(process.cwd(), 'bookings_data.json');
const credentialsPath = path.join(process.cwd(), 'semiotic-sylph-490711-d9-cc0a28009e2c.json');
const CSV_FILE = 'c:\\Users\\ritik\\OneDrive\\Desktop\\customer_details\\MASTER_BOOKING_SHEET_SMART.csv';
const DATA_ROOT = 'c:\\Users\\ritik\\OneDrive\\Desktop\\customer_details\\data';

// Replace this with your actual Google Sheet ID (from the URL of your sheet)
// Or define it in a .env.local file as GOOGLE_SHEET_ID
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1Pxe23SgQoVsITyMi1_AibtLnJ9Hut9KDxoM9d6yvrMc";

// Helper to parse complex court strings (e.g., "T1,2", "IP1,3", "4,5,6")
function parseCourtIdentifiers(courtStr: string): { courts: string[], sport: string } {
  const clean = (courtStr || '').toUpperCase()
    .replace(/COURTS?\s*NO\s*/g, 'C')
    .replace(/TRUFS?\s*NO\s*/g, 'T')
    .replace(/TURFS?\s*NO\s*/g, 'T')
    .replace(/INDOOR\s*PITCH\s*NO\s*/g, 'IP')
    .replace(/OUTPITCH\s*NO\s*/g, 'OP')
    .replace(/OUTPITCH/g, 'OP')
    .replace(/1P/g, 'IP').replace(/0P/g, 'OP').replace(/O P/g, 'OP').replace(/T /g, 'T')
    .replace(/INDOOR PITCH/g, 'IP').replace(/OUTDOOR PITCH/g, 'OP').replace(/COURT/g, 'C')
    .replace(/&/g, ',').replace(/\s+/g, ' ');

  let sport = 'Cricket/Football';
  let prefix = 'T'; // Default to Turf
  
  if (clean.includes('IP')) { sport = 'Indoor Pitch'; prefix = 'IP'; }
  else if (clean.includes('OP')) { sport = 'Outdoor Pitch'; prefix = 'OP'; }
  else if (clean.includes('PB')) { sport = 'Pickleball'; prefix = 'PB'; }
  else if (clean.includes('C')) { sport = 'Court'; prefix = 'C'; }
  else if (clean.includes('T')) { sport = 'Turf'; prefix = 'T'; }
  else if (clean.match(/^P\s*\d/)) { sport = 'Indoor Pitch'; prefix = 'IP'; } // Treat P1-P10 as IP
  else if (clean.match(/^\d/)) { sport = 'Turf'; prefix = 'T'; }

  const courts: string[] = [];
  const segments = clean.split(/[,/]+/).map(s => s.trim()).filter(Boolean);
  
  segments.forEach(seg => {
    // Handle "P1" -> "IP1"
    let currentSeg = seg;
    if (seg.startsWith('P') && !seg.startsWith('PB') && !seg.startsWith('PITCH')) {
      currentSeg = 'IP' + seg.substring(1);
    }

    const match = currentSeg.match(/^([A-Z]+)\s*(\d+(?:[\s\d,]*))$/);
    if (match) {
      const p = match[1];
      const nums = match[2].split(/[\s,]+/).filter(Boolean);
      nums.forEach(n => courts.push(`${p}${n}`));
    } else if (currentSeg.match(/^[\d\s,]+$/)) {
      const nums = currentSeg.split(/[\s,]+/).filter(Boolean);
      nums.forEach(n => courts.push(`${prefix}${n}`));
    } else if (currentSeg.match(/^[A-Z]+\d+$/)) {
      courts.push(currentSeg);
    } else if (currentSeg.length > 0) {
      courts.push(currentSeg);
    }
  });

  return { courts: courts.length > 0 ? courts : [courtStr], sport };
}

// Helper to parse time strings (e.g., "7-9pm") into hours
function parseTimeRange(t: string): { start: string, end: string, duration: number } {
  if (!t || typeof t !== 'string') return { start: 'N/A', end: 'N/A', duration: 0 };
  const clean = t.toLowerCase().replace(/[\.\s]/g, ':').replace(/:{2,}/g, ':').replace(/\s+/g, '');
  const match = clean.match(/(\d{1,2}(?::\d{2})?[ap]m)-(\d{1,2}(?::\d{2})?[ap]m)/);
  
  if (match) {
    const start = match[1].toUpperCase();
    const end = match[2].toUpperCase();
    const parseH = (s: string) => {
      let [hStr, mStr] = s.replace(/[AP]M/g, '').split(':');
      let h = parseInt(hStr);
      let m = parseInt(mStr) || 0;
      if (s.includes('PM') && h !== 12) h += 12;
      if (s.includes('AM') && h === 12) h = 0;
      return h + m / 60;
    };
    let startH = parseH(start);
    let endH = parseH(end);
    if (endH <= startH) endH += 24;
    return { start, end, duration: endH - startH };
  }
  return { start: t.split('-')[0]?.trim().toUpperCase() || 'N/A', end: t.split('-')[1]?.trim().toUpperCase() || 'N/A', duration: 0 };
}

// Helper to read from the smart local CSV
function getBookingsFromCSV(): Booking[] {
  try {
    if (!fs.existsSync(CSV_FILE)) return [];
    const content = fs.readFileSync(CSV_FILE, 'utf8');
    const lines = content.split('\n');
    
    // Skip header and map to Booking interface
    // CSV Header: Booking ID,Date,Customer Name,Phone Number,Venue,Court,Time Slot,Hours,Price,Source
    return lines.slice(1).filter(l => l.trim()).map((line) => {
      // Robust split (handles names with commas if quoted, but simple for now)
      const parts = line.split(',');
      const date = parts[1]?.trim() || '';
      
      return {
        id: parts[0]?.trim() || `local-${Math.random()}`,
        date: date,
        customerName: parts[2]?.trim() || 'Unknown',
        phoneNumber: parts[3]?.trim() || '',
        bookingPlatform: 'Offline',
        platformName: 'Imported',
        venue: parts[4]?.trim() as any,
        sports: [parseCourtIdentifiers(parts[5]?.trim()).sport], 
        courtNumbers: [parts[5]?.trim()],
        startTime: parts[6]?.trim()?.split('-')[0]?.trim() || '',
        endTime: parts[6]?.trim()?.split('-')[1]?.trim() || '',
        hours: parseFloat(parts[7] || '0'),
        price: parseFloat(parts[8] || '0'),
        timestamp: new Date(date).toISOString(),
      };
    });
  } catch (error) {
    console.error("Error reading CSV:", error);
    return [];
  }
}

// Dynamic Excel Fetcher
function getBookingsFromDynamicExcel(): Booking[] {
  const bookings: Booking[] = [];
  try {
    if (!fs.existsSync(DATA_ROOT)) return [];

    const venues = ['borivali', 'banner'];
    venues.forEach(v => {
      const vPath = path.join(DATA_ROOT, v);
      if (!fs.existsSync(vPath)) return;

      const files = fs.readdirSync(vPath, { recursive: true }) as string[];
      files.forEach(file => {
        if (!file.endsWith('.xlsx')) return;
        
        const fullPath = path.join(vPath, file);
        const workbook = XLSX.readFile(fullPath);
        
        workbook.SheetNames.forEach(sheetName => {
          if (sheetName.toUpperCase().includes('END')) return;
          const sheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
          
          // Basic Ingestion Logic (Simplified version of precision_court_ingestor)
          let date = "";
          let headerRowIdx = -1;
          const mapping: any = {};

          // Find date and headers
          for (let i = 0; i < Math.min(20, data.length); i++) {
            const row = data[i];
            if (!row) continue;
            const rowStr = row.join(' ').toUpperCase();
            
            // Date detection
            const dateMatch = rowStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
            if (dateMatch && !date) {
              let [_, d, m, y] = dateMatch;
              if (y.length === 2) y = '20' + y;
              date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            }

            // Header detection
            if (rowStr.includes('NAME') && (rowStr.includes('TURF') || rowStr.includes('COURT'))) {
              headerRowIdx = i;
              row.forEach((cell: any, idx: number) => {
                const s = String(cell || '').toUpperCase();
                if (s.includes('NAME')) mapping.name = idx;
                if (s.includes('CONTACT') || s.includes('NUMBER')) mapping.phone = idx;
                if (s.includes('TURF') || s.includes('COURT')) mapping.court = idx;
                if (s.includes('TIME')) mapping.time = idx;
                if (s.includes('HOURS')) mapping.hours = idx;
                if (s.includes('TOTAL') || s.includes('BALANCE')) mapping.price = idx;
              });
              break;
            }
          }

          if (headerRowIdx !== -1 && mapping.name !== undefined && date) {
            for (let i = headerRowIdx + 1; i < data.length; i++) {
              const row = data[i];
              if (!row || !row[mapping.name]) continue;
              
              const name = String(row[mapping.name]).trim();
              if (name.toUpperCase().includes('TOTAL') || name.toUpperCase().includes('NAME')) continue;
              
              const courtStr = String(row[mapping.court] || '');
              const timeStr = String(row[mapping.time] || '');
              const price = parseFloat(row[mapping.price]) || 0;
              const sheetHours = parseFloat(row[mapping.hours]) || 0;

              const { start, end, duration } = parseTimeRange(timeStr);
              const actualHours = sheetHours > 0 ? sheetHours : duration;

              // Advanced Court Parsing (Handles "ip1,2,3", "1p 3,4", "op 5,7", "t1,2,3", "4,5,6")
              const cleanCourt = courtStr.toUpperCase()
                .replace(/1P/g, 'IP') // Fix common typo
                .replace(/0P/g, 'OP') // Fix "zero" instead of "O"
                .replace(/O P/g, 'OP')
                .replace(/T /g, 'T')  // Fix "T 1" to "T1"
                .replace(/&/g, ',')
                .replace(/\s+/g, ' ');
              
              // Smart Sport Detection (needed for prefix inference)
              let sport = 'Cricket/Football';
              let inferredPrefix = '';
              if (cleanCourt.includes('IP')) { sport = 'Indoor Pitch'; inferredPrefix = 'IP'; }
              else if (cleanCourt.includes('OP')) { sport = 'Outdoor Pitch'; inferredPrefix = 'OP'; }
              else if (cleanCourt.includes('T')) { sport = 'Turf'; inferredPrefix = 'T'; }
              else if (cleanCourt.includes('PB')) { sport = 'Pickleball'; inferredPrefix = 'PB'; }
              else if (cleanCourt.match(/^\d/)) { sport = 'Turf'; inferredPrefix = 'T'; } // Default numbers to Turf

              const courtParts: string[] = [];
              const segments = cleanCourt.split(/[,/]+/).map(s => s.trim()).filter(Boolean);
              
              segments.forEach(seg => {
                // Case 1: Prefix + Numbers (e.g., "IP1,2,3", "T 3,4")
                const match = seg.match(/^([A-Z]+)\s*(\d+(?:[\s\d,]*))$/);
                if (match) {
                  const prefix = match[1];
                  const nums = match[2].split(/[\s,]+/).filter(Boolean);
                  nums.forEach(n => courtParts.push(`${prefix}${n}`));
                } 
                // Case 2: Pure Numbers (e.g., "4,5,6" -> "T4", "T5", "T6")
                else if (seg.match(/^[\d\s,]+$/)) {
                  const nums = seg.split(/[\s,]+/).filter(Boolean);
                  nums.forEach(n => courtParts.push(`${inferredPrefix}${n}`));
                }
                // Case 3: Standard single code (e.g., "T1")
                else if (seg.match(/^[A-Z]+\d+$/)) {
                  courtParts.push(seg);
                } 
                // Case 4: Fallback
                else if (seg.length > 0) {
                  courtParts.push(seg);
                }
              });

              bookings.push({
                id: `dyn-${bookings.length}`,
                date,
                customerName: name,
                phoneNumber: String(row[mapping.phone] || ''),
                bookingPlatform: 'Offline',
                platformName: 'Excel',
                venue: (v === 'borivali' ? 'Borivali' : 'Baner') as any,
                sports: [sport],
                courtNumbers: courtParts.length > 0 ? courtParts : [courtStr],
                startTime: start,
                endTime: end,
                hours: actualHours,
                price: price,
                timestamp: new Date(date).toISOString(),
              });
            }
          }
        });
      });
    });
  } catch (error) {
    console.error("Error dynamic fetching:", error);
  }
  return bookings;
}

// Helper to get bookings from file or fallback to dummy
function getBookings(): Booking[] {
  try {
    // 1. Prioritize the high-fidelity Smart CSV
    if (fs.existsSync(CSV_FILE)) {
      const csvBookings = getBookingsFromCSV();
      if (csvBookings.length > 0) return csvBookings;
    }

    // 2. Fallback to dynamic Excel only if CSV is missing
    const dynamicBookings = getBookingsFromDynamicExcel();
    if (dynamicBookings.length > 0) return dynamicBookings;

    // 3. Fallback to local JSON
    if (fs.existsSync(dataFilePath)) {
      const fileData = fs.readFileSync(dataFilePath, 'utf8');
      return JSON.parse(fileData);
    } else {
      fs.writeFileSync(dataFilePath, JSON.stringify(dummyBookings, null, 2));
      return dummyBookings;
    }
  } catch (error) {
    console.error("Error reading bookings data:", error);
    return dummyBookings;
  }
}

// Helper to append data to Google Sheets
async function appendToGoogleSheet(bookings: Booking[]) {
  try {
    if (!fs.existsSync(credentialsPath)) {
      console.warn("⚠️ credentials.json not found. Skipping Google Sheets upload. Data will only be saved locally.");
      return;
    }

    if (SPREADSHEET_ID === "YOUR_GOOGLE_SHEET_ID_HERE") {
      console.warn("⚠️ SPREADSHEET_ID is not configured. Skipping Google Sheets upload. Data will only be saved locally.");
      return;
    }

    // Vercel Compatibility: Use env variable if JSON file is missing
    let auth;
    if (fs.existsSync(credentialsPath)) {
      auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      console.warn("⚠️ No Google credentials found (JSON file or ENV). Skipping sync.");
      return;
    }

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client as any });

    // Separate bookings into Staff entries and General entries
    const staffEntries = bookings.filter(b => (b as any).staffName);
    const generalEntries = bookings.filter(b => !(b as any).staffName);

    if (staffEntries.length > 0) {
      const staffHeaders = [
        'Date', 'Customer Name', 'Phone Number', 'Venue', 'Sports', 
        'Court No', 'Start Time', 'End Time', 'Total Hours', 
        'Amount Collected', 'Payment Mode', 'Staff Name'
      ];

      // Check if sheet is empty and add headers if needed
      const sheetResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'staff_data!A1:A1',
      });

      if (!sheetResponse.data.values || sheetResponse.data.values.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: 'staff_data!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [staffHeaders] },
        });
        console.log("📝 Added headers to 'staff_data'.");
      }

      const staffValues = staffEntries.map(b => [
        (b as any).date,
        (b as any).customerName,
        (b as any).phoneNumber,
        (b as any).venue,
        Array.isArray(b.sports) ? b.sports.join(', ') : b.sports,
        Array.isArray(b.courtNumbers) ? b.courtNumbers.join(', ') : b.courtNumbers,
        (b as any).startTime,
        (b as any).endTime,
        (b as any).totalHours || b.hours,
        (b as any).amountCollected || b.price,
        (b as any).paymentMode || "Offline",
        (b as any).staffName
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'staff_data!A:L',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: staffValues },
      });
      console.log(`✅ Synced ${staffEntries.length} entries to 'staff_data'.`);
    }

    if (generalEntries.length > 0) {
      const generalValues = generalEntries.map(b => [
        b.id,
        b.date,
        b.customerName,
        b.phoneNumber,
        b.bookingPlatform,
        b.platformName || "N/A",
        b.venue,
        b.sports.join(', '),
        b.courtNumbers.join(', '),
        b.startTime,
        b.endTime,
        b.hours,
        b.price,
        (b as any).staffName || "N/A",
        (b as any).paymentMode || "N/A"
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Master Data!A:O',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: generalValues },
      });
      console.log(`✅ Synced ${generalEntries.length} entries to 'Master Data'.`);
    }
  } catch (error: any) {
    console.error("❌ Failed to append to Google Sheets:", error.message);
    if (error.response) {
      console.error("❌ Google API Error Details:", JSON.stringify(error.response.data, null, 2));
    }
  }
}

async function getBookingsFromSheet(): Promise<Booking[]> {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client as any });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Master Data!A2:M',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return [];

    function excelDateToJSDate(serial: any) {
      if (!serial) return "";
      
      // If it already looks like a date string (YYYY-MM-DD or DD-MM-YYYY), don't convert
      if (typeof serial === 'string' && (serial.includes('-') || serial.includes('/'))) {
        return serial;
      }

      const s = parseFloat(serial);
      if (isNaN(s) || s < 25569) return serial; // 25569 is 1970-01-01
      
      // Excel serial date to JS date
      const date = new Date(Math.round((s - 25569) * 86400 * 1000));
      return date.toISOString().split('T')[0];
    }

    return rows.map(row => {
      const date = excelDateToJSDate(row[1]);
      return {
        id: row[0],
        date: date,
        customerName: row[2],
        phoneNumber: row[3],
        bookingPlatform: row[4] as any,
        platformName: row[5],
        venue: row[6] as any,
        sports: [row[7]],
        courtNumbers: (row[8] || "").split(', '),
        startTime: row[9],
        endTime: row[10],
        hours: parseFloat(row[11] || "0"),
        price: parseFloat(row[12] || "0"),
        timestamp: new Date(date).toISOString(),
      };
    });
  } catch (error) {
    console.error("Error reading from sheet, falling back to local:", error);
    return getBookings();
  }
}

export async function GET() {
  const bookings = await getBookingsFromSheet();
  return NextResponse.json({ bookings });
}

export async function POST(request: Request) {
  try {
    const { newBookings } = await request.json();
    if (!newBookings || !Array.isArray(newBookings)) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    // 1. Save locally as fallback and for dashboard persistence
    const currentBookings = getBookings();
    const updatedBookings = [...newBookings, ...currentBookings];
    fs.writeFileSync(dataFilePath, JSON.stringify(updatedBookings, null, 2));

    // 2. Upload to Google Sheets
    await appendToGoogleSheet(newBookings);

    return NextResponse.json({ success: true, bookings: updatedBookings });
  } catch (error) {
    console.error("Error saving bookings data:", error);
    return NextResponse.json({ error: 'Failed to save data' }, { status: 500 });
  }
}
