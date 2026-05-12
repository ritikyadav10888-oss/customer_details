import pandas as pd
import os

MASTER_CSV = r'c:\Users\ritik\OneDrive\Desktop\customer_details\MASTER_BOOKING_SHEET_LOCAL.csv'
OUTPUT_CSV = r'c:\Users\ritik\OneDrive\Desktop\customer_details\CUSTOMER_LIST.csv'

def is_junk(name, phone):
    name = str(name).upper()
    phone = str(phone).upper()
    
    # 1. Names that are just numbers or dates
    if name.replace('.','').replace('-','').strip().isnumeric(): return True
    
    # 2. Accounting and Misc Junk Keywords
    junk_keywords = [
        'TOTAL', 'COLLECTION', 'BAL', 'HOURS', 'HOUR\'S', 'ADV', 'GRAND', 'CASH', 'GPAY', 'G-PAY', 'MACHINE', 
        'CARD', 'TIME', 'CONTACT', 'REC', 'NIMBOOZ', 'BOX', 'BALL', 'ELEC', 'FAN', 'CHAIR', 'TABLE', 'ROYALTY',
        'WATER', 'FAST UP', 'LIGHT', 'RENT', 'GST', 'BILL', 'PERMISSION', 'SOUND', 'POLICE', 'STATION', 
        'FOOD', 'SPIT', 'CLEANLINESS', 'OCCUPIED', 'TURF', 'IP', 'OP', 'PB', 'CRICKET', 'FOOTBALL'
    ]
    if any(k in name for k in junk_keywords): return True
    
    # 3. Rules/Sentences (usually very long strings)
    if len(name) > 40: return True
    
    # 4. Unknowns
    if name == 'UNKNOWN' or name == 'NAN': return True
    
    return False

def main():
    if not os.path.exists(MASTER_CSV):
        print(f"Error: Master CSV not found at {MASTER_CSV}")
        return

    print("Extracting unique customer list...")
    df = pd.read_csv(MASTER_CSV)
    
    # Filter only relevant columns
    customers = df[['Customer Name', 'Phone Number']].copy()
    
    # Clean up phone numbers and names
    customers['Customer Name'] = customers['Customer Name'].fillna('Unknown').str.strip()
    
    # 1. Clean Phone Numbers (remove spaces, dashes, brackets)
    customers['Phone Number'] = customers['Phone Number'].astype(str).str.replace(r'[\s\-\(\)\[\]]', '', regex=True)
    
    # 2. Strict 10-12 Digit Filter
    # Only keep if phone is numeric and long enough (handling potential 91 prefix)
    customers = customers[customers['Phone Number'].str.isnumeric()]
    customers = customers[customers['Phone Number'].str.len().between(10, 13)]
    
    # Remove duplicates
    unique_customers = customers.drop_duplicates().reset_index(drop=True)
    
    # Apply Aggressive Junk Filter for Name
    unique_customers['is_junk'] = unique_customers.apply(lambda x: is_junk(x['Customer Name'], x['Phone Number']), axis=1)
    unique_customers = unique_customers[unique_customers['is_junk'] == False].drop(columns=['is_junk'])
    
    # Sort by Name
    unique_customers = unique_customers.sort_values('Customer Name')
    
    # Save to CSV
    unique_customers.to_csv(OUTPUT_CSV, index=False)
    print(f"Success! {len(unique_customers)} unique customers extracted to: {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
