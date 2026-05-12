import os
import pandas as pd
import re
from datetime import datetime

# Configuration
DATA_ROOT = r'c:\Users\ritik\OneDrive\Desktop\customer_details\data'
OUTPUT_CSV = r'c:\Users\ritik\OneDrive\Desktop\customer_details\MASTER_BOOKING_SHEET_SMART.csv'

def clean_name(name):
    if not name or pd.isna(name): return ''
    n = str(name).strip()
    if n.lower() in ['nan', 'none', '-', '']: return ''
    # Remove common suffixes like SIR, MA'AM, etc
    n = re.sub(r'\s+(SIR|MA\'AM|Bhai|Ji|Sir FB)$', '', n, flags=re.I)
    return n.title()

def clean_phone(phone):
    if not phone or pd.isna(phone): return ''
    p = str(phone).strip().replace('.0', '')
    p = re.sub(r'[\s\-\(\)\[\]]', '', p)
    if len(p) == 12 and p.startswith('91'): p = p[2:]
    return p

def parse_date_string(s):
    """Extracts date from strings like 'JANUARY 2024 (01/01/2024), MONDAY'"""
    if not s or pd.isna(s): return None
    # Look for DD/MM/YYYY or DD-MM-YYYY
    match = re.search(r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})', str(s))
    if match:
        d, m, y = match.groups()
        if len(y) == 2: y = '20' + y
        try:
            # Validate it's a real date
            dt = datetime(int(y), int(m), int(d))
            return dt.strftime('%Y-%m-%d')
        except: return None
    return None

def split_courts(court_str):
    if not court_str or pd.isna(court_str): return []
    # Split by &, comma, and, /
    parts = re.split(r'[,&/]| and ', str(court_str), flags=re.I)
    courts = []
    current_prefix = ""
    for p in parts:
        p = p.strip()
        if not p: continue
        # Try to find prefix (IP, OP, T, PB, C)
        match = re.match(r'^([A-Za-z]+)\s*(\d+.*)$', p)
        if match:
            current_prefix = match.group(1).upper()
            courts.append(p.upper().replace(' ', ''))
        elif p.isdigit() and current_prefix:
            courts.append(f"{current_prefix}{p}")
        else:
            courts.append(p.upper().replace(' ', ''))
    return [c for c in courts if c and c.lower() not in ['nan', 'none', 'court', 'turf']]

def is_junk_row(name, court, mapping):
    n = str(name).upper()
    c = str(court).upper()
    junk_keywords = [
        'TOTAL', 'COLLECTION', 'BAL', 'ADV', 'GRAND', 'CASH', 'GPAY', 'G-PAY', 'ROYALTY', 'DIRECTORS',
        'NIMBOOZ', 'BALL', 'ELEC', 'FAN', 'CHAIR', 'TABLE', 'WATER', 'RENT', 'GST', 'BILL', 'PERMISSION',
        'POLICE', 'STATION', 'FOOD', 'CLEANLINESS', 'OCCUPIED', 'SUMMARY', 'PAYMENT', 'ACCOUNT', 'CHECK',
        'NAME', 'CONTACT', 'TURF', 'TIME'
    ]
    if not name or n == '' or n == 'NAN': return True
    if any(k in n for k in junk_keywords): return True
    if any(k in c for k in junk_keywords): return True
    # If name contains a date pattern, it's a date header, not a booking
    if re.search(r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}', n): return True
    if n.replace('.', '').replace('-', '').strip().isnumeric(): return True
    if len(n) > 50: return True
    return False

def process_excel(file_path, venue):
    print(f"Processing {venue}: {os.path.basename(file_path)}")
    all_bookings = []
    try:
        xl = pd.ExcelFile(file_path)
        for sheet_name in xl.sheet_names:
            if any(k in sheet_name.upper() for k in ['END', 'BAL', 'SUMMARY', 'ROYALTY', 'ACCOUNT']): continue
            df = pd.read_excel(xl, sheet_name=sheet_name, header=None)
            
            active_date = None
            mapping = {}
            header_found = False
            
            for i in range(len(df)):
                row_raw = df.iloc[i].tolist()
                row = [str(x) for x in row_raw]
                row_str = ' '.join([x for x in row if x != 'nan']).upper()
                
                # 1. Check for Date update ONLY in non-booking rows (few columns filled)
                # Date headers usually have most columns empty
                non_empty = [x for x in row_raw if pd.notna(x) and str(x).strip() != '']
                if len(non_empty) <= 3:
                    new_date = parse_date_string(row_str)
                    if new_date:
                        active_date = new_date
                
                # 2. Check for Header row
                if 'NAME' in row_str and ('TURF' in row_str or 'COURT' in row_str or 'IP' in row_str):
                    mapping = {}
                    for idx, cell in enumerate(row_raw):
                        cell_s = str(cell).upper()
                        if 'NAME' in cell_s: mapping['name'] = idx
                        if 'CONTACT' in cell_s or 'NUMBER' in cell_s: mapping['phone'] = idx
                        if 'TURF' in cell_s or 'COURT' in cell_s or 'IP' in cell_s or 'OP' in cell_s: mapping['court'] = idx
                        if 'TIME' in cell_s: mapping['time'] = idx
                        if 'HOURS' in cell_s: mapping['hours'] = idx
                        if 'TOTAL' in cell_s and 'AMOUNT' in cell_s: mapping['total'] = idx
                        elif 'TOTAL' in cell_s and 'total' not in mapping: mapping['total'] = idx
                        elif 'BALANCE' in cell_s and 'total' not in mapping: mapping['total'] = idx
                    header_found = True
                    continue
                
                # 3. Process Booking Row
                if header_found and 'name' in mapping:
                    name_val = row[mapping['name']]
                    court_val = row[mapping['court']] if 'court' in mapping else None
                    
                    if is_junk_row(name_val, court_val, mapping):
                        continue
                        
                    # If we have a name but no active_date yet, try to find one in the file path as fallback
                    if not active_date:
                        # Fallback logic for date if missing in sheet (rare but possible)
                        mon_map = {'JAN':'01','FEB':'02','MAR':'03','APR':'04','MAY':'05','JUN':'06','JUL':'07','AUG':'08','SEP':'09','OCT':'10','NOV':'11','DEC':'12'}
                        mon_match = re.search(r'(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)', file_path.upper())
                        day_match = re.search(r'(\d+)', sheet_name)
                        if mon_match and day_match:
                            active_date = f"2024-{mon_map[mon_match.group(0)]}-{day_match.group(0).zfill(2)}"
                    
                    if not active_date: continue
                    
                    # Extraction
                    name = clean_name(name_val)
                    phone = clean_phone(row[mapping['phone']]) if 'phone' in mapping else ''
                    court_str = str(court_val) if court_val else ''
                    time_str = str(row[mapping['time']]) if 'time' in mapping else ''
                    
                    try:
                        total_hours = float(row[mapping['hours']]) if 'hours' in mapping and pd.notna(row[mapping['hours']]) else 0
                    except: total_hours = 0
                    
                    try:
                        total_price = float(row[mapping['total']]) if 'total' in mapping and pd.notna(row[mapping['total']]) else 0
                    except: total_price = 0
                    
                    # Split Courts
                    courts = split_courts(court_str)
                    if not courts: courts = [court_str]
                    
                    num_courts = len(courts)
                    price_per_court = total_price / num_courts if num_courts > 0 else total_price
                    hours_per_court = total_hours / num_courts if num_courts > 0 else total_hours
                    
                    # Sport Detection
                    for c in courts:
                        sport = 'Cricket/Football'
                        uc = c.upper()
                        if 'IP' in uc: sport = 'Indoor Pitch'
                        elif 'OP' in uc: sport = 'Outdoor Pitch'
                        elif 'PB' in uc or uc.startswith('C'): sport = 'Pickleball'
                        
                        all_bookings.append({
                            'Date': active_date,
                            'Customer Name': name,
                            'Phone Number': phone,
                            'Venue': venue,
                            'Court': c,
                            'Time Slot': time_str,
                            'Hours': round(hours_per_court, 2),
                            'Price': round(price_per_court, 2),
                            'Source': f"{os.path.basename(file_path)} | {sheet_name}"
                        })
                        
    except Exception as e:
        print(f"Error in {file_path}: {e}")
    return all_bookings

def main():
    final_data = []
    
    # Borivali
    borivali_path = os.path.join(DATA_ROOT, 'borivali')
    for year in ['2024', '2025', '2026']:
        year_path = os.path.join(borivali_path, year)
        if not os.path.exists(year_path): continue
        for f in os.listdir(year_path):
            if f.endswith('.xlsx'):
                final_data.extend(process_excel(os.path.join(year_path, f), 'Borivali'))
                
    # Baner
    baner_path = os.path.join(DATA_ROOT, 'banner')
    if os.path.exists(baner_path):
        for f in os.listdir(baner_path):
            if f.endswith('.xlsx'):
                final_data.extend(process_excel(os.path.join(baner_path, f), 'Baner'))
                
    if not final_data:
        print("No data extracted!")
        return
        
    df = pd.DataFrame(final_data)
    # Sort by date
    df = df.sort_values(['Date', 'Customer Name'])
    # Add ID
    df.insert(0, 'Booking ID', range(1, len(df) + 1))
    
    df.to_csv(OUTPUT_CSV, index=False)
    print(f"Successfully saved {len(df)} bookings to {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
