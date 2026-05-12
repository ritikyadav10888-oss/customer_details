import os
import pandas as pd
import re
from datetime import datetime

# Configuration
BORIVALI_ROOT = r'c:\Users\ritik\OneDrive\Desktop\customer_details\data\borivali'
BANER_ROOT = r'c:\Users\ritik\OneDrive\Desktop\customer_details\data\banner'
OUTPUT_CSV = r'c:\Users\ritik\OneDrive\Desktop\customer_details\MASTER_BOOKING_SHEET_LOCAL.csv'

def clean_name(name):
    if not name or pd.isna(name): return 'Unknown'
    return re.sub(r'\(.*\)|\[.*\]', '', str(name)).strip()

def get_merged_val(row, idx):
    """Helper to find data in merged or shifted columns by checking neighbors."""
    if idx < 0 or idx >= len(row): return None
    val = row[idx]
    if pd.notna(val) and str(val).strip(): return val
    # Check immediate left and right neighbors for horizontal merges
    for offset in [-1, 1]:
        n_idx = idx + offset
        if 0 <= n_idx < len(row):
            n_val = row[n_idx]
            if pd.notna(n_val) and str(n_val).strip() and not any(k in str(n_val).upper() for k in ['NAME', 'TIME', 'TURF', 'TOTAL']):
                return n_val
    return None

def parse_time(time_str):
    if not time_str or pd.isna(time_str) or not isinstance(time_str, str):
        return 'N/A', 'N/A', 0.0
    
    clean = time_str.lower().replace(' ', '').replace('.', ':')
    # More flexible regex: handle cases like 7-8pm, 7pm-8pm, 7:30-9:30am
    match = re.search(r'(\d{1,2}(?::\d{2})?(?:[ap]m)?)-(\d{1,2}(?::\d{2})?[ap]m)', clean)
    if match:
        start_str, end_str = match.groups()
        
        # If start doesn't have AM/PM but end does, assume same as end
        if 'am' not in start_str and 'pm' not in start_str:
            if 'pm' in end_str: start_str += 'pm'
            else: start_str += 'am'

        def to_hours(s):
            s = s.upper()
            parts = re.split(r'[:]', s.replace('AM', '').replace('PM', ''))
            try:
                h = int(parts[0])
                m = int(parts[1]) if len(parts) > 1 and parts[1] else 0
                if 'PM' in s and h != 12: h += 12
                if 'AM' in s and h == 12: h = 0
                return h + m / 60.0
            except: return 0.0

        s_h = to_hours(start_str)
        e_h = to_hours(end_str)
        if e_h <= s_h: e_h += 24
        return start_str.upper(), end_str.upper(), (e_h - s_h)
    
    return 'N/A', 'N/A', 0.0

def process_excel(file_path, venue):
    bookings = []
    try:
        xl = pd.ExcelFile(file_path)
        for sheet_name in xl.sheet_names:
            if 'END' in sheet_name.upper(): continue
            df = pd.read_excel(xl, sheet_name=sheet_name, header=None)
            
            # Find Date
            active_date = None
            for i in range(min(15, len(df))):
                row_vals = [str(x) for x in df.iloc[i].tolist() if pd.notna(x)]
                row_str = ' '.join(row_vals)
                date_match = re.search(r'(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})', row_str)
                if date_match:
                    d, m, y = date_match.groups()
                    if len(y) == 2: y = '20' + y
                    active_date = f"{y}-{m.zfill(2)}-{d.zfill(2)}"
                    break
            
            if not active_date:
                mon_map = {'JAN':'01','FEB':'02','MAR':'03','APR':'04','MAY':'05','JUN':'06','JUL':'07','AUG':'08','SEP':'09','OCT':'10','NOV':'11','DEC':'12'}
                mon_match = re.search(r'(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)', file_path.upper())
                day_match = re.search(r'\d+', sheet_name)
                if mon_match and day_match:
                    active_date = f"2026-{mon_map[mon_match.group(0)]}-{day_match.group(0).zfill(2)}"
            
            if not active_date: continue

            # Find Headers
            header_row_idx = -1
            mapping = {}
            for i in range(len(df)):
                row_vals = [str(x).upper() for x in df.iloc[i].tolist()]
                row_txt = ' '.join(row_vals)
                if 'NAME' in row_txt and ('TURF' in row_txt or 'COURT' in row_txt or 'PB' in row_txt or 'IP' in row_txt):
                    header_row_idx = i
                    for idx, cell in enumerate(row_vals):
                        if 'NAME' in cell: mapping['name'] = idx
                        if 'CONTACT' in cell or 'NUMBER' in cell: mapping['phone'] = idx
                        if 'TURF' in cell or 'COURT' in cell or 'PB' in cell or 'IP' in cell: mapping['court'] = idx
                        if 'TIME' in cell: mapping['time'] = idx
                        if 'HOURS' in cell: mapping['hours'] = idx
                        if 'TOTAL' in cell or 'BALANCE' in cell:
                            if 'total' not in mapping or 'TOTAL' in cell: mapping['total'] = idx
                    break
            
            if header_row_idx == -1 or 'name' not in mapping: continue

            last_n, last_p, last_s, last_e, last_dur = None, None, 'N/A', 'N/A', 0.0
            for i in range(header_row_idx + 1, len(df)):
                row = df.iloc[i]
                try:
                    name_cell = row[mapping['name']]
                    name = str(name_cell).strip() if pd.notna(name_cell) else last_n
                    
                    # Skip if we hit the summary/total section, equipment rentals, or rules
                    junk_keywords = [
                        'TOTAL', 'COLLECTION', 'BAL', 'HOURS', 'HOUR\'S', 'ADV', 'GRAND', 'CASH', 'GPAY', 'G-PAY', 'MACHINE', 
                        'CARD', 'TIME', 'CONTACT', 'REC', 'NIMBOOZ', 'BOX', 'BALL', 'ELEC', 'FAN', 'CHAIR', 'TABLE', 'ROYALTY',
                        'WATER', 'FAST UP', 'LIGHT', 'RENT', 'GST', 'BILL', 'PERMISSION', 'SOUND', 'POLICE', 'STATION', 
                        'FOOD', 'SPIT', 'CLEANLINESS', 'OCCUPIED', 'TURF'
                    ]
                    
                    if name:
                        name_u = name.upper()
                        if any(keyword in name_u for keyword in junk_keywords) or name_u.replace('.','').replace('-','').strip().isnumeric() or len(name) > 40:
                            if any(k in name_u for k in ['TOTAL', 'PAYMENT', 'SUMMARY', 'BALANCE']):
                                if i > header_row_idx + 2: break # Stop sheet processing on major totals
                            continue # Skip individual junk/rule rows
                    
                    phone_cell = get_merged_val(row, mapping.get('phone', mapping['name']))
                    phone = str(phone_cell).strip() if phone_cell else last_p
                    
                    court_cell = get_merged_val(row, mapping['court'])
                    court = str(court_cell).strip() if court_cell else None
                    
                    # Skip if court number is a 'TOTAL' summary row
                    if court and 'TOTAL' in court.upper():
                        continue
                    
                    time_cell = get_merged_val(row, mapping['time'])
                    time_val = str(time_cell).strip() if time_cell else None
                    
                    if not name or not court or 'NAME' in str(name).upper() or 'TOTAL' in str(name).upper():
                        if pd.isna(name_cell) and pd.isna(court_cell):
                            last_n, last_p, last_s, last_e, last_dur = None, None, 'N/A', 'N/A', 0.0
                        continue
                    
                    # Process time: use current or fallback to last seen
                    start, end, duration = parse_time(time_val)
                    if start == 'N/A' and last_s != 'N/A':
                        start, end, duration = last_s, last_e, last_dur
                    
                    if start != 'N/A':
                        last_s, last_e, last_dur = start, end, duration

                    last_n, last_p = name, phone
                    
                    # Hours
                    sheet_h = 0
                    if 'hours' in mapping:
                        try: sheet_h = float(row[mapping['hours']])
                        except: pass
                    total_h = sheet_h if sheet_h > 0 else duration

                    # Price
                    price = 0
                    if 'total' in mapping:
                        try: price = float(row[mapping['total']])
                        except: pass

                    # Platform
                    platform, b_type = 'WhatsApp', 'Offline'
                    p_str = str(phone).upper()
                    if 'PLAYO' in p_str: platform, b_type = 'Playo', 'Online'
                    elif 'PLAYSPOTS' in p_str: platform, b_type = 'PlaySpots', 'Online'
                    elif 'KHELOMORE' in p_str: platform, b_type = 'KheloMore', 'Online'

                    # Sports Detection
                    sports_list = []
                    c_upper = str(court).upper()
                    
                    if 'IP' in c_upper or 'INDOOR' in c_upper: 
                        sports_list.append('Indoor Pitch')
                    if 'OP' in c_upper or 'OUTDOOR' in c_upper: 
                        sports_list.append('Outdoor Pitch')
                    if 'PB' in c_upper or 'PICKLEBALL' in c_upper or 'C1' in c_upper or (c_upper.startswith('C') and 'CRICKET' not in c_upper): 
                        sports_list.append('Pickleball')
                    
                    # Add Cricket/Football only if T is present or if no other sport was detected yet
                    if 'T' in c_upper or not sports_list:
                        if 'Cricket/Football' not in sports_list:
                            sports_list.append('Cricket/Football')

                    for s in sports_list:
                        # Pattern-based Court Extraction (Comma-proof)
                        # Finds things like 'IP1', 'OP2', or just '2'
                        segments = re.findall(r'([A-Za-z]+\d+|\d+)', str(court))
                        processed_parts = []
                        current_prefix = ""
                        
                        for p in segments:
                            prefix_match = re.match(r'^([A-Za-z]+)', p)
                            if prefix_match:
                                current_prefix = prefix_match.group(1).upper()
                                processed_parts.append(p.upper())
                            elif current_prefix:
                                processed_parts.append(f"{current_prefix}{p}")
                            else:
                                processed_parts.append(p.upper())

                        relevant_court = court
                        if s == 'Indoor Pitch':
                            relevant_court = ','.join([p for p in processed_parts if 'IP' in p.upper()])
                        elif s == 'Outdoor Pitch':
                            relevant_court = ','.join([p for p in processed_parts if 'OP' in p.upper()])
                        elif s == 'Pickleball':
                            relevant_court = ','.join([p for p in processed_parts if 'PB' in p.upper() or 'C' in p.upper()])
                        elif s == 'Cricket/Football':
                            relevant_court = ','.join([p for p in processed_parts if 'T' in p.upper() or ('IP' not in p.upper() and 'OP' not in p.upper() and 'PB' not in p.upper() and 'C' not in p.upper())])
                        
                        if not relevant_court: relevant_court = court # Fallback

                        bookings.append({
                            'Date': active_date, 'Customer Name': clean_name(name), 'Phone Number': phone,
                            'Booking Type': b_type, 'Platform Name': platform, 'Venue': venue,
                            'Sports': s, 'Court Numbers': relevant_court, 'Start Time': start, 'End Time': end,
                            'Total Hours': round(total_h, 2), 'Price': round(price / len(sports_list), 2)
                        })
                except Exception as row_err:
                    continue
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
    return bookings

def main():
    print("Starting Python Master Ingestor...")
    all_bookings = []

    # Borivali
    for y in ['2024', '2025', '2026']:
        year_path = os.path.join(BORIVALI_ROOT, y)
        if not os.path.exists(year_path): continue
        for f in os.listdir(year_path):
            if f.endswith('.xlsx'):
                print(f"  Reading Borivali {y}/{f}...")
                all_bookings.extend(process_excel(os.path.join(year_path, f), 'Borivali'))

    # Baner
    if os.path.exists(BANER_ROOT):
        for f in os.listdir(BANER_ROOT):
            if f.endswith('.xlsx'):
                print(f"  Reading Baner {f}...")
                all_bookings.extend(process_excel(os.path.join(BANER_ROOT, f), 'Baner'))

    print(f"Extracted {len(all_bookings)} records.")
    
    if not all_bookings:
        print("No records found. Check folder paths.")
        return

    # Create DataFrame
    df_final = pd.DataFrame(all_bookings)
    df_final['Date'] = pd.to_datetime(df_final['Date'])
    df_final = df_final.sort_values('Date')
    df_final.insert(0, 'Booking ID', range(1, len(df_final) + 1))
    
    # Save to CSV
    df_final.to_csv(OUTPUT_CSV, index=False)
    print(f"Master Sheet Saved: {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
