import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { Booking, dummyBookings } from '@/lib/dummyData';

const dataFilePath = path.join(process.cwd(), 'bookings_data.json');
const credentialsPath = path.join(process.cwd(), 'semiotic-sylph-490711-d9-cc0a28009e2c.json');
const CSV_FILE = path.join(process.cwd(), 'MASTER_BOOKING_SHEET_SMART.csv');
const DATA_ROOT = path.join(process.cwd(), 'data');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1Pxe23SgQoVsITyMi1_AibtLnJ9Hut9KDxoM9d6yvrMc";

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

async function getBookings(): Promise<Booking[]> {
  try {
    if (process.env.VERCEL && !fs.existsSync(dataFilePath)) return dummyBookings;
    if (!fs.existsSync(dataFilePath)) return dummyBookings;
    const data = await fs.promises.readFile(dataFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading local bookings data:", error);
    return dummyBookings;
  }
}

async function saveBooking(booking: Booking) {
  try {
    const bookings = await getBookings();
    bookings.push(booking);
    if (!process.env.VERCEL) {
      await fs.promises.writeFile(dataFilePath, JSON.stringify(bookings, null, 2));
    }
  } catch (error) {
    console.error("Error saving local booking data:", error);
  }
}

async function appendToGoogleSheet(bookings: Booking[]) {
  try {
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
      console.warn("⚠️ No Google credentials found. Skipping sync.");
      return;
    }

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client as any });

    const staffEntries = bookings.filter(b => (b as any).staffName);
    const generalEntries = bookings.filter(b => !(b as any).staffName);

    if (staffEntries.length > 0) {
      const staffHeaders = [
        'Date', 'Customer Name', 'Phone Number', 'Venue', 'Sports', 
        'Court No', 'Start Time', 'End Time', 'Total Hours', 
        'Amount Collected', 'Payment Mode', 'Staff Name'
      ];

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
      }

      const staffValues = staffEntries.map(b => [
        (b as any).date, (b as any).customerName, (b as any).phoneNumber, (b as any).venue,
        Array.isArray(b.sports) ? b.sports.join(', ') : b.sports,
        Array.isArray(b.courtNumbers) ? b.courtNumbers.join(', ') : b.courtNumbers,
        (b as any).startTime, (b as any).endTime, (b as any).totalHours || b.hours,
        (b as any).amountCollected || b.price, (b as any).paymentMode || "Offline", (b as any).staffName
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'staff_data!A:L',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: staffValues },
      });
    }

    if (generalEntries.length > 0) {
      const generalValues = generalEntries.map(b => [
        b.id, b.date, b.customerName, b.phoneNumber, b.bookingPlatform,
        b.platformName || "N/A", b.venue, b.sports.join(', '), b.courtNumbers.join(', '),
        b.startTime, b.endTime, b.hours, b.price, (b as any).staffName || "N/A", (b as any).paymentMode || "N/A"
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Master Data!A:O',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: generalValues },
      });
    }
  } catch (error: any) {
    console.error("❌ Google Sync Error:", error.message);
  }
}

function excelDateToJSDate(serial: any) {
  if (!serial) return "";
  if (typeof serial === 'string' && (serial.includes('-') || serial.includes('/'))) return serial;
  const s = parseFloat(serial);
  if (isNaN(s) || s < 25569) return serial;
  const date = new Date(Math.round((s - 25569) * 86400 * 1000));
  return date.toISOString().split('T')[0];
}

async function getBookingsFromSheet(): Promise<Booking[]> {
  try {
    let auth;
    if (fs.existsSync(credentialsPath)) {
      auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
    } else {
      return getBookings();
    }

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client as any });

    const [masterResponse, staffResponse] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Master Data!A2:O' }),
      sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'staff_data!A2:L' })
    ]);

    const masterRows = masterResponse.data.values || [];
    const staffRows = staffResponse.data.values || [];

    const masterBookings: Booking[] = masterRows.map((row, i) => ({
      id: row[0] || `m-${i}`,
      date: excelDateToJSDate(row[1]),
      customerName: row[2] || 'Unknown',
      phoneNumber: row[3] || '',
      bookingPlatform: (row[4] || 'Offline') as any,
      platformName: row[5] || 'Excel',
      venue: (row[6] || 'Borivali') as any,
      sports: [row[7] || 'Cricket'],
      courtNumbers: (row[8] || "").split(', ').filter(Boolean),
      startTime: row[9] || '',
      endTime: row[10] || '',
      hours: parseFloat(row[11] || "0"),
      price: parseFloat(row[12] || "0"),
      timestamp: new Date().toISOString(),
    }));

    const staffBookings: Booking[] = staffRows.map((row, i) => ({
      id: `s-${i}`,
      date: excelDateToJSDate(row[0]),
      customerName: row[1] || 'Unknown',
      phoneNumber: row[2] || '',
      bookingPlatform: 'Offline',
      platformName: 'Staff Portal',
      venue: (row[3] || 'Borivali') as any,
      sports: [row[4] || 'Cricket'],
      courtNumbers: (row[5] || "").split(', ').filter(Boolean),
      startTime: row[6] || '',
      endTime: row[7] || '',
      hours: parseFloat(row[8] || "0"),
      price: parseFloat(row[9] || "0"),
      timestamp: new Date().toISOString(),
    }));

    return [...staffBookings, ...masterBookings];
  } catch (error) {
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

    // Process new bookings
    for (const b of newBookings) {
      await saveBooking(b);
    }
    
    await appendToGoogleSheet(newBookings);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
