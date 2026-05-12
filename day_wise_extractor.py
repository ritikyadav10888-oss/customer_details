"""
Smart Day-Wise Booking Extractor
================================

Scans every Excel sheet under data/banner and data/borivali (2024/2025/2026),
handles every layout variation we have, and emits a single accurate
day-by-day CSV with the exact columns the user requested:

    Booking ID, Date, Customer Name, Phone Number, Booking Type,
    Platform Name, Venue, Sports, Court Numbers, Start Time, End Time,
    Total Hours, Price

Layout variations supported:
  A. 2024 Borivali "Royalty Charges" style    -> date in col 0 of each row
  B. 2024 Borivali "Jan 1st & 2nd" style      -> multiple dates per sheet
     (date rows like "JANUARY 2024 (01/01/2024), MONDAY")
  C. 2024 Dec+ / 2025 / 2026 Borivali         -> one sheet per day with
     header in row 0 like "01/12/2024, Sunday Booking List..."
     Multiple sections (Turf, IP/OP, PB) inside the same sheet.
  D. 2025 Aug+ Borivali & all 2026 Baner      -> same as C with a
     Cash/G-pay sub-header row after the main header row.

Continuation rows (empty name but Court & Time present) are attributed to
the previous customer; only the row that actually carries the price is
charged with the price so totals do not double-count.
"""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime
from typing import Optional

import pandas as pd


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_ROOT = os.path.join(ROOT, 'data')
OUTPUT_CSV = os.path.join(ROOT, 'MASTER_BOOKING_SHEET_DAY_WISE.csv')

# Sheets we always skip (not actual day sheets)
SKIP_SHEET_KEYWORDS = (
    'ROYALTY', 'BAL SHEET', 'ACCOUNT', 'SUMMARY', 'SLOT',
    'PAYMENT', 'MONTHLY', 'TOTAL', 'COLLECTION',
)

# Junk markers for rows that are clearly not bookings.
JUNK_NAME_KEYWORDS = (
    'TOTAL', 'COLLECTION', 'GRAND', 'BAL ', 'BALANCE', 'PAYMENT', 'SUMMARY',
    'ROYALTY', 'WATER', 'BALL', 'COLD DRINKS', 'PADDLE', 'BAT RENT',
    'ELECTRICITY', 'ELECTRIC', 'GST', 'BILL', 'CHAIR', 'TABLE',
    'CASH', 'GPAY', 'G-PAY', 'GOOGLE PAY', 'MACHINE', 'SCANNER', 'SE GPAY',
    'NIMBOOZ', 'CARD', 'PERMISSION', 'POLICE', 'STATION', 'CLEANLINESS',
    'OCCUPIED', 'CONTACT NO', 'CONTACT  NO', 'CONTACTNO', 'CONTACT', 'NAME',
    'TIME', 'TURF', 'PB COURT', 'IP ', 'OP ', 'IP&', 'IP/', 'IP NO',
    'NUMBER', 'PRICE', 'HOURS', 'HOUR', 'ADVANCE', 'ADV REC', 'BALANCE REC',
)

ONLINE_PLATFORMS = {
    'PLAYO': 'Playo',
    'PLAYSPOT': 'PlaySpots',
    'PLAYSPOTS': 'PlaySpots',
    'KHELOMORE': 'KheloMore',
    'HUDLE': 'Hudle',
}

MONTH_MAP = {
    'JAN': '01', 'JANUARY': '01',
    'FEB': '02', 'FEBRUARY': '02', 'FEBUARY': '02',
    'MAR': '03', 'MARCH': '03',
    'APR': '04', 'APRIL': '04',
    'MAY': '05',
    'JUN': '06', 'JUNE': '06',
    'JUL': '07', 'JULY': '07',
    'AUG': '08', 'AUGUST': '08',
    'SEP': '09', 'SEPT': '09', 'SEPTEMBER': '09',
    'OCT': '10', 'OCTOBER': '10',
    'NOV': '11', 'NOVEMBER': '11',
    'DEC': '12', 'DECEMBER': '12',
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def cell_str(v) -> str:
    if v is None:
        return ''
    if isinstance(v, float) and pd.isna(v):
        return ''
    s = str(v).strip()
    if s.lower() in ('nan', 'none', 'nat'):
        return ''
    return s


def row_to_strings(row) -> list[str]:
    return [cell_str(v) for v in row.tolist()]


def clean_name(name: str) -> str:
    n = re.sub(r'\(.*?\)|\[.*?\]', '', name).strip()
    n = re.sub(r'\s+', ' ', n)
    # Strip honorifics that aren't part of the actual name
    n = re.sub(r'\b(Sir FB|SIR|MA\'AM|MADAM|BHAI|BHAIYA|JI)\b\.?\s*$', '', n, flags=re.I).strip()
    return n


def clean_phone(phone: str) -> str:
    if not phone:
        return ''
    p = phone.strip()
    # Strip trailing ".0" from float-typed cells
    if p.endswith('.0'):
        p = p[:-2]
    # Online-platform markers are not phone numbers
    upper = p.upper()
    for marker in ONLINE_PLATFORMS:
        if marker in upper:
            return ''
    p = re.sub(r'[\s\-\(\)\[\]]', '', p)
    if p.startswith('+91'):
        p = p[3:]
    if len(p) == 12 and p.startswith('91') and p[2:].isdigit():
        p = p[2:]
    if not p.isdigit():
        return ''
    return p


def parse_date_token(token: str) -> Optional[str]:
    """
    Parse a date anywhere inside a string -> YYYY-MM-DD.

    Recognises both:
      * YYYY-MM-DD / YYYY/MM/DD  (preferred, tried first)
      * DD/MM/YYYY / D-M-YY      (the common spreadsheet form)

    Returns None on failure.
    """
    if not token:
        return None
    # Prefer YYYY-MM-DD (anchored on a 4-digit year first)
    m = re.search(r'(20\d{2})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})', token)
    if m:
        y, mo, d = m.groups()
        try:
            return datetime(int(y), int(mo), int(d)).strftime('%Y-%m-%d')
        except ValueError:
            pass
    # Fall back to DD/MM/YYYY
    m = re.search(r'(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})', token)
    if not m:
        return None
    d, mo, y = m.groups()
    if len(y) == 2:
        y = '20' + y
    try:
        return datetime(int(y), int(mo), int(d)).strftime('%Y-%m-%d')
    except ValueError:
        return None


def parse_excel_date(v) -> Optional[str]:
    """If cell already is a datetime/date or pandas Timestamp, return ISO."""
    if isinstance(v, (datetime, pd.Timestamp)):
        try:
            return v.strftime('%Y-%m-%d')
        except Exception:
            return None
    return None


def file_year_hint(path: str) -> Optional[int]:
    """Pick a year hint from the file path (2024/2025/2026)."""
    for y in ('2024', '2025', '2026'):
        if y in path:
            return int(y)
    m = re.search(r'(20\d{2})', path)
    return int(m.group(1)) if m else None


def file_month_hint(path: str) -> Optional[int]:
    upper = os.path.basename(path).upper()
    # Order matters - try long names first
    for name in sorted(MONTH_MAP, key=len, reverse=True):
        if re.search(rf'\b{name}\b', upper):
            return int(MONTH_MAP[name])
    return None


def sheet_date_hint(sheet_name: str, file_path: str) -> Optional[str]:
    """Best-effort date from sheet name + file path."""
    m = re.search(r'(\d{1,2})', sheet_name)
    if not m:
        return None
    day = int(m.group(1))
    if not (1 <= day <= 31):
        return None
    year = file_year_hint(file_path)
    month = None

    sheet_upper = sheet_name.upper()
    for name in sorted(MONTH_MAP, key=len, reverse=True):
        if name in sheet_upper:
            month = int(MONTH_MAP[name])
            break
    if month is None:
        month = file_month_hint(file_path)
    if year is None or month is None:
        return None
    try:
        return datetime(year, month, day).strftime('%Y-%m-%d')
    except ValueError:
        return None


_AMPM_RE = re.compile(
    r'(\d{1,2})(?:[:\.](\d{1,2}))?\s*([apAP][mM])?'
    r'\s*[-–to]+\s*'
    r'(\d{1,2})(?:[:\.](\d{1,2}))?\s*([apAP][mM])',
    re.IGNORECASE,
)


def _decimal_hours_to_hhmm(dec_hours: float) -> str:
    """Convert fractional hour-of-day (e.g. 22.5) to 24h HH:MM for CSV/Sheets."""
    if dec_hours < 0 or dec_hours != dec_hours:  # NaN guard
        return ''
    total_minutes = int(round(dec_hours * 60)) % (24 * 60)
    h, m = divmod(total_minutes, 60)
    return f'{h:02d}:{m:02d}'


def parse_time_range(s: str) -> tuple[str, str, float]:
    """
    Parse '7pm - 9pm', '7.30pm-9.30pm', '10pm-12am', '6.30AM - 8AM' etc.

    Returns (start, end, hours). Empty strings + 0.0 when unparseable.
    """
    if not s:
        return '', '', 0.0
    cleaned = s.replace('\u2013', '-').replace('–', '-').replace('to', '-')
    cleaned = cleaned.replace('.', ':').lower()
    m = _AMPM_RE.search(cleaned.upper())
    if not m:
        # Try a simpler "9am-11am" form without colons (already covered) or
        # 24-hour times like "21:00-22:00"
        m24 = re.search(r'(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})', cleaned)
        if m24:
            sh, sm, eh, em = (int(x) for x in m24.groups())
            start = f"{sh:02d}:{sm:02d}"
            end = f"{eh:02d}:{em:02d}"
            dur = (eh + em / 60) - (sh + sm / 60)
            if dur <= 0:
                dur += 24
            return start, end, round(dur, 2)
        return '', '', 0.0

    sh, sm, sap, eh, em, eap = m.groups()
    sh = int(sh)
    eh = int(eh)
    sm = int(sm) if sm else 0
    em = int(em) if em else 0
    sap = (sap or '').upper()
    eap = (eap or '').upper()

    # If start has no AM/PM, copy from end
    if not sap:
        sap = eap

    def to_24(h: int, mm: int, ap: str) -> float:
        if ap == 'AM':
            if h == 12:
                h = 0
        elif ap == 'PM':
            if h != 12:
                h += 12
        return h + mm / 60

    s24 = to_24(sh, sm, sap)
    e24 = to_24(eh, em, eap)
    if e24 <= s24:
        e24 += 24
    dur = round(e24 - s24, 2)
    # Always emit 24h HH:MM so Google Sheets never mis-reads "10PM" as a formula
    # or auto-converts to an opaque serial fraction in the cell.
    return _decimal_hours_to_hhmm(s24), _decimal_hours_to_hhmm(e24), dur


def is_junk_name(name: str) -> bool:
    if not name:
        return True
    up = name.upper()
    if any(k in up for k in JUNK_NAME_KEYWORDS):
        return True
    if re.fullmatch(r'[\d\s\.\-/]+', up):
        return True
    return False


_TIME_LIKE = re.compile(r'\b(AM|PM)\b', re.IGNORECASE)


def split_courts(court_str: str) -> tuple[list[str], str]:
    """
    Split 'T1 & T2', 'T1,T2,T3', 'IP3,4', 'T5,T6' etc into a clean list.

    Returns (court_list, sport_type) where sport_type is the inferred sport
    category for this section ('Turf', 'IP', 'OP', 'PB').
    """
    if not court_str:
        return [], ''
    # If the value is actually a time range (e.g. '9pm - 10pm (T6)') we got it
    # from a misaligned column - bail out with empty list.
    if _TIME_LIKE.search(court_str):
        return [], ''
    raw = court_str.upper().replace('&', ',').replace(' AND ', ',').replace('/', ',')
    parts = [p.strip() for p in raw.split(',') if p.strip()]

    courts: list[str] = []
    current_prefix = ''
    for p in parts:
        # Handle stuff like "T1" or "IP3"
        m = re.match(r'^([A-Z]+)\s*0*(\d+)([A-Z]?)$', p)
        if m:
            current_prefix = m.group(1)
            num = m.group(2)
            suffix = m.group(3)
            courts.append(f"{current_prefix}{num}{suffix}")
            continue
        # Just a number -> use current prefix
        m2 = re.match(r'^0*(\d+)([A-Z]?)$', p)
        if m2 and current_prefix:
            courts.append(f"{current_prefix}{m2.group(1)}{m2.group(2)}")
            continue
        # Anything else (e.g. "C1", "PB1") - just take it
        if p:
            courts.append(p.replace(' ', ''))

    return courts, ''


# ---------------------------------------------------------------------------
# Header / section detection
# ---------------------------------------------------------------------------
HEADER_NAME_TOKEN = re.compile(r'\bNAME\b', re.IGNORECASE)
HEADER_COURT_TOKENS = ('TURF', 'COURT', 'IP', 'OP', 'PB')


def looks_like_header(row_strs: list[str]) -> bool:
    upper = [s.upper() for s in row_strs]
    has_name = any(s.strip() in ('NAME', 'NAME ') or s.strip().startswith('NAME ') for s in upper)
    if not has_name:
        return False
    has_court = any(any(t in s for t in HEADER_COURT_TOKENS) for s in upper)
    has_time = any(s.strip() in ('TIME', 'TIMING') or s.strip().startswith('TIME ') for s in upper)
    has_hours = any('HOURS' in s or 'HOUR' == s.strip() for s in upper)
    # Reject combined "Name & Number" advance-booking note tables - they don't
    # have a separate Hours column.
    has_combined_name = any('&' in s and 'NAME' in s for s in upper)
    if has_combined_name and not has_hours:
        return False
    return has_court and has_time


def looks_like_cash_gpay_subheader(row_strs: list[str]) -> bool:
    upper = [s.upper() for s in row_strs if s]
    if not upper:
        return False
    relevant = [s for s in upper if s in ('CASH', 'G-PAY', 'GPAY', 'G PAY')]
    return len(relevant) >= 2 and len(upper) <= 12


def detect_section_sport(header_strs: list[str]) -> str:
    """Detect the sport for the section based on the header row."""
    up = ' '.join(s.upper() for s in header_strs)
    if 'PB' in up or 'PICKLEBALL' in up:
        return 'Pickleball'
    if 'IP' in up and 'OP' in up:
        return 'Indoor/Outdoor Cricket'
    if 'IP' in up:
        return 'Indoor Cricket'
    if 'OP' in up:
        return 'Outdoor Cricket'
    return 'Cricket/Football'


def build_column_map(header_strs: list[str]) -> dict[str, int]:
    """Map logical fields -> column indices using the header row."""
    mapping: dict[str, int] = {}
    for idx, cell in enumerate(header_strs):
        u = cell.upper().strip()
        if not u:
            continue
        if 'name' not in mapping and 'NAME' in u:
            mapping['name'] = idx
            continue
        if 'phone' not in mapping and ('CONTACT' in u or 'NUMBER' in u or u == 'PHONE'):
            mapping['phone'] = idx
            continue
        if 'court' not in mapping and any(t in u for t in ('TURF NO', 'COURT', 'IP NO', 'OP NO', 'PB COURT', 'IP & OP', 'IP&OP')):
            mapping['court'] = idx
            continue
        if 'court' not in mapping and any(t in u for t in ('TURF', 'IP', 'OP', 'PB')) and 'PAID' not in u and 'BAL' not in u:
            mapping['court'] = idx
            continue
        if 'time' not in mapping and ('TIME' in u or 'TIMING' in u) and 'ADV' not in u and 'BAL' not in u and 'REC' not in u:
            mapping['time'] = idx
            continue
        if 'hours' not in mapping and ('HOURS' in u or 'HOUR' == u or 'NO OF HOURS' in u):
            mapping['hours'] = idx
            continue
        if 'price_per_hour' not in mapping and 'PRICE' in u and 'HOUR' in u:
            mapping['price_per_hour'] = idx
            continue
        if 'total' not in mapping and ('TOTAL AMOUNT' in u or u == 'TOTAL' or 'TOTAL PAYMENT' in u or 'TOTAL PAYMEN' in u):
            mapping['total'] = idx
            continue
    return mapping


# ---------------------------------------------------------------------------
# Format-A: 2024 Borivali "Royalty Charges" (date in column 0)
# ---------------------------------------------------------------------------
def looks_like_format_a(df: pd.DataFrame) -> bool:
    if len(df) < 2:
        return False
    head = row_to_strings(df.iloc[0])
    up = ' '.join(s.upper() for s in head)
    return ('DATE' in up and 'NAME' in up and 'NUMBER' in up
            and ('TURF' in up or 'COURT' in up))


def extract_format_a(df: pd.DataFrame, venue: str, source: str) -> list[dict]:
    bookings: list[dict] = []
    header = row_to_strings(df.iloc[0])
    mapping = build_column_map(header)
    # Manually patch: column 0 = DATE in this format
    if 'date' not in mapping:
        for idx, cell in enumerate(header):
            if cell.upper().startswith('DATE'):
                mapping['date'] = idx
                break
    if 'date' not in mapping:
        mapping['date'] = 0

    last_date = None
    last_name = ''
    last_phone = ''

    for i in range(1, len(df)):
        row = df.iloc[i]
        raw_cells = row.tolist()
        strs = row_to_strings(row)

        # Update date if this row has one
        d_idx = mapping['date']
        d_val = raw_cells[d_idx] if d_idx < len(raw_cells) else None
        d_iso = parse_excel_date(d_val) or parse_date_token(cell_str(d_val))
        if d_iso:
            last_date = d_iso

        # Get name / phone
        name = strs[mapping['name']] if 'name' in mapping and mapping['name'] < len(strs) else ''
        phone_raw = strs[mapping['phone']] if 'phone' in mapping and mapping['phone'] < len(strs) else ''
        court = strs[mapping['court']] if 'court' in mapping and mapping['court'] < len(strs) else ''
        time_v = strs[mapping['time']] if 'time' in mapping and mapping['time'] < len(strs) else ''

        if not court and not name:
            continue
        if name and is_junk_name(name):
            # Could still be a continuation we want to skip
            continue
        if not name:
            # Continuation row -> inherit name/phone from prior
            name = last_name
            phone_raw = last_phone
        else:
            last_name = name
            last_phone = phone_raw

        if not last_date:
            continue

        hours_v = strs[mapping['hours']] if 'hours' in mapping and mapping['hours'] < len(strs) else ''
        total_v = strs[mapping['total']] if 'total' in mapping and mapping['total'] < len(strs) else ''

        bookings.append(_emit_record(
            date_iso=last_date,
            name=name,
            phone_raw=phone_raw,
            court_str=court,
            time_str=time_v,
            hours_str=hours_v,
            price_str=total_v,
            venue=venue,
            sport_hint='Cricket/Football',
            source=source,
        ))
    return [b for b in bookings if b]


# ---------------------------------------------------------------------------
# Format-B/C/D: per-sheet processor (handles all the modern layouts)
# ---------------------------------------------------------------------------
def extract_modern_sheet(df: pd.DataFrame, sheet_name: str, file_path: str, venue: str) -> list[dict]:
    source = f"{os.path.basename(file_path)} :: {sheet_name}"
    if len(df) == 0:
        return []

    # Try to seed the active date from row 0 / sheet name
    active_date = None
    if len(df) > 0:
        first_row_str = ' '.join(row_to_strings(df.iloc[0]))
        active_date = parse_date_token(first_row_str)
    if not active_date:
        active_date = sheet_date_hint(sheet_name, file_path)

    bookings: list[dict] = []
    mapping: dict[str, int] = {}
    section_sport = 'Cricket/Football'
    header_active = False
    last_name = ''
    last_phone = ''

    for i in range(len(df)):
        row = df.iloc[i]
        strs = row_to_strings(row)
        non_empty = [s for s in strs if s]
        joined_upper = ' '.join(non_empty).upper()

        # 1. Update active date when we encounter a date inside the sheet
        if non_empty:
            new_date = parse_date_token(joined_upper)
            if new_date and (len(non_empty) <= 3 or 'BOOKING' in joined_upper or 'SHEET' in joined_upper or 'LIST' in joined_upper):
                active_date = new_date

        # 2. Header detection
        if looks_like_header(strs):
            mapping = build_column_map(strs)
            section_sport = detect_section_sport(strs)
            header_active = 'name' in mapping and 'court' in mapping
            last_name = ''
            last_phone = ''
            continue

        # 3. Skip the Cash/G-pay sub-header row that follows the header
        if header_active and looks_like_cash_gpay_subheader(strs):
            continue

        # 4. Skip "TOTAL HOUR's & PAYMENT" footer rows -> end of section
        if non_empty and 'TOTAL' in joined_upper and ('HOUR' in joined_upper or 'PAYMENT' in joined_upper):
            header_active = False
            mapping = {}
            last_name = ''
            last_phone = ''
            continue

        if not header_active or 'name' not in mapping or 'court' not in mapping:
            continue
        if not active_date:
            continue

        name = strs[mapping['name']] if mapping['name'] < len(strs) else ''
        phone_raw = strs[mapping['phone']] if 'phone' in mapping and mapping['phone'] < len(strs) else ''
        court = strs[mapping['court']] if mapping['court'] < len(strs) else ''
        time_v = strs[mapping['time']] if 'time' in mapping and mapping['time'] < len(strs) else ''
        hours_v = strs[mapping['hours']] if 'hours' in mapping and mapping['hours'] < len(strs) else ''
        total_v = strs[mapping['total']] if 'total' in mapping and mapping['total'] < len(strs) else ''

        # Continuation: empty name but court / time present -> attribute to prev
        if not name and (court or time_v):
            name = last_name
            phone_raw = phone_raw or last_phone

        # Skip empty rows entirely
        if not name and not court and not time_v:
            continue

        # Drop obvious non-bookings
        if name and is_junk_name(name):
            continue

        # If still no name (very rare), skip
        if not name:
            continue

        last_name = name
        if phone_raw:
            last_phone = phone_raw

        bookings.append(_emit_record(
            date_iso=active_date,
            name=name,
            phone_raw=phone_raw,
            court_str=court,
            time_str=time_v,
            hours_str=hours_v,
            price_str=total_v,
            venue=venue,
            sport_hint=section_sport,
            source=source,
        ))

    return [b for b in bookings if b]


# ---------------------------------------------------------------------------
# Record emission (shared)
# ---------------------------------------------------------------------------
def _to_float(s: str) -> float:
    if not s:
        return 0.0
    s2 = s.replace(',', '').strip()
    # If multiple tokens, grab the first number
    m = re.search(r'-?\d+(?:\.\d+)?', s2)
    if not m:
        return 0.0
    try:
        return float(m.group(0))
    except ValueError:
        return 0.0


def _detect_platform(name: str, phone_raw: str, court_str: str) -> tuple[str, str]:
    """Returns (booking_type, platform_name)."""
    blob = f"{name} | {phone_raw} | {court_str}".upper()
    for marker, label in ONLINE_PLATFORMS.items():
        if marker in blob:
            return 'Online', label
    if 'NET PRACTICE' in blob:
        return 'Offline', 'Net Practice'
    if 'HUDLE' in blob:
        return 'Online', 'Hudle'
    return 'Offline', 'Direct'


def _refine_sport(court_str: str, section_hint: str) -> str:
    up = court_str.upper()
    if 'PB' in up or up.strip().startswith('C') and not up.strip().startswith('COURT'):
        return 'Pickleball'
    if 'IP' in up and 'OP' in up:
        return 'Indoor/Outdoor Cricket'
    if 'IP' in up:
        return 'Indoor Cricket'
    if 'OP' in up:
        return 'Outdoor Cricket'
    if re.search(r'\bT\d', up):
        return 'Cricket/Football'
    return section_hint or 'Cricket/Football'


def _emit_record(*, date_iso: str, name: str, phone_raw: str,
                 court_str: str, time_str: str, hours_str: str,
                 price_str: str, venue: str, sport_hint: str,
                 source: str) -> Optional[dict]:
    name_clean = clean_name(name)
    if not name_clean or is_junk_name(name_clean):
        return None
    phone_clean = clean_phone(phone_raw)
    start, end, parsed_hours = parse_time_range(time_str)

    hours = _to_float(hours_str)
    if hours <= 0:
        hours = parsed_hours

    price = _to_float(price_str)
    booking_type, platform = _detect_platform(name, phone_raw, court_str)
    sport = _refine_sport(court_str, sport_hint)

    courts, _ = split_courts(court_str)
    # If the "court" field actually looks like a time range or other junk,
    # the row is misaligned - drop it.
    if not courts and (not court_str.strip() or _TIME_LIKE.search(court_str)):
        return None
    court_numbers = ','.join(courts) if courts else court_str.strip()

    return {
        'Date': date_iso,
        'Customer Name': name_clean,
        'Phone Number': phone_clean,
        'Booking Type': booking_type,
        'Platform Name': platform,
        'Venue': venue,
        'Sports': sport,
        'Court Numbers': court_numbers,
        'Start Time': start,
        'End Time': end,
        'Total Hours': round(hours, 2),
        'Price': round(price, 2),
        '_source': source,
    }


# ---------------------------------------------------------------------------
# File-level driver
# ---------------------------------------------------------------------------
def process_file(file_path: str, venue: str) -> list[dict]:
    rel = os.path.relpath(file_path, ROOT)
    print(f"  -> {venue:8s} | {rel}")
    bookings: list[dict] = []
    try:
        xl = pd.ExcelFile(file_path)
    except Exception as e:
        print(f"     !! Cannot open: {e}")
        return []

    for sheet_name in xl.sheet_names:
        up = sheet_name.upper()
        if any(k in up for k in SKIP_SHEET_KEYWORDS) and 'JAN' not in up and 'FEB' not in up and 'MAR' not in up:
            continue
        try:
            df = pd.read_excel(xl, sheet_name=sheet_name, header=None)
        except Exception as e:
            print(f"     !! Cannot read sheet '{sheet_name}': {e}")
            continue
        if df.empty:
            continue

        try:
            if looks_like_format_a(df):
                bookings.extend(extract_format_a(df, venue, f"{os.path.basename(file_path)} :: {sheet_name}"))
            else:
                bookings.extend(extract_modern_sheet(df, sheet_name, file_path, venue))
        except Exception as e:
            print(f"     !! Error in sheet '{sheet_name}': {e}")
            continue
    return bookings


def main() -> None:
    print(f"DATA_ROOT = {DATA_ROOT}")
    all_bookings: list[dict] = []

    # Borivali (2024 / 2025 / 2026)
    bori_root = os.path.join(DATA_ROOT, 'borivali')
    if os.path.isdir(bori_root):
        for year in sorted(os.listdir(bori_root)):
            year_dir = os.path.join(bori_root, year)
            if not os.path.isdir(year_dir):
                continue
            for fname in sorted(os.listdir(year_dir)):
                if fname.lower().endswith('.xlsx'):
                    all_bookings.extend(process_file(os.path.join(year_dir, fname), 'Borivali'))

    # Baner (single folder, file names carry month/year)
    baner_root = os.path.join(DATA_ROOT, 'banner')
    if os.path.isdir(baner_root):
        for fname in sorted(os.listdir(baner_root)):
            if fname.lower().endswith('.xlsx'):
                all_bookings.extend(process_file(os.path.join(baner_root, fname), 'Baner'))

    if not all_bookings:
        print("No bookings extracted!")
        return

    df = pd.DataFrame(all_bookings)
    df['Date'] = pd.to_datetime(df['Date'], errors='coerce')
    df = df.dropna(subset=['Date'])
    df = df.sort_values(['Date', 'Venue', 'Start Time', 'Customer Name']).reset_index(drop=True)
    df.insert(0, 'Booking ID', [f"BK{idx:06d}" for idx in range(1, len(df) + 1)])
    df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')

    # Final column order (keep _source for traceability but drop from primary CSV)
    primary_cols = [
        'Booking ID', 'Date', 'Customer Name', 'Phone Number',
        'Booking Type', 'Platform Name', 'Venue', 'Sports',
        'Court Numbers', 'Start Time', 'End Time', 'Total Hours', 'Price',
    ]
    df_out = df[primary_cols].copy()
    df_out.to_csv(OUTPUT_CSV, index=False)
    print(f"\n[OK] Wrote {len(df_out):,} bookings to:\n    {OUTPUT_CSV}")

    # Also save a debug version with the source column for spot-checks
    debug_path = OUTPUT_CSV.replace('.csv', '_DEBUG.csv')
    df_debug = df[primary_cols + ['_source']].copy()
    df_debug.to_csv(debug_path, index=False)
    print(f"[OK] Debug copy with sources -> {debug_path}")

    # Print quick stats
    print("\n--- Summary ---")
    print(f"Total bookings:    {len(df_out):,}")
    print(f"Unique customers:  {df_out['Customer Name'].nunique():,}")
    print(f"Date range:        {df_out['Date'].min()} -> {df_out['Date'].max()}")
    print(f"Venues:            {dict(df_out['Venue'].value_counts())}")
    print(f"Booking types:     {dict(df_out['Booking Type'].value_counts())}")
    print(f"Top platforms:")
    for p, n in df_out['Platform Name'].value_counts().head(8).items():
        print(f"   {p:15s} {n:6d}")
    print(f"Sports breakdown:")
    for s, n in df_out['Sports'].value_counts().items():
        print(f"   {s:25s} {n:6d}")


if __name__ == '__main__':
    main()
