export type Booking = {
  id: string;
  customerName: string;
  phoneNumber: string;
  bookingPlatform: "Online" | "Offline";
  platformName?: string; // e.g., Playo, Huddle (if online)
  date: string; // e.g., "2026-05-08"
  startTime: string; // e.g., "02:00 PM"
  endTime: string;   // e.g., "03:30 PM"
  hours: number;
  courtNumbers: string[];
  sports: string[];
  venue: typeof MOCK_VENUES[number];
  price: number;
  timestamp: string; // ISO String
};

export const MOCK_VENUES = ["Borivali", "Baner"] as const;

// Helper to generate a random booking
const generateBooking = (id: number): Booking => {
  const venues = [...MOCK_VENUES];
  const sports = ["Pickleball", "Futsal", "Box Cricket", "Tennis"];
  const platforms = ["Playo", "Huddle", "BookMyShow", "Direct"];
  
  const isOnline = Math.random() > 0.4;
  const platformName = isOnline ? platforms[Math.floor(Math.random() * (platforms.length - 1))] : undefined;
  
  // Random time within the last 7 days
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * 7));
  date.setHours(8 + Math.floor(Math.random() * 14), 0, 0, 0); // between 8 AM and 10 PM

  const hours = Math.floor(Math.random() * 3) + 1;
  const startHour = 8 + Math.floor(Math.random() * (14 - hours));
  
  const formatTime = (h: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12.toString().padStart(2, '0')}:00 ${ampm}`;
  };

  const startTime = formatTime(startHour);
  const endTime = formatTime(startHour + hours);

  return {
    id: `BKG-${1000 + id}`,
    customerName: `Customer ${id}`,
    phoneNumber: `+91 98765${Math.floor(10000 + Math.random() * 90000)}`,
    bookingPlatform: isOnline ? "Online" : "Offline",
    platformName: platformName,
    date: date.toISOString().split('T')[0],
    startTime,
    endTime,
    hours,
    courtNumbers: [String(Math.floor(Math.random() * 5) + 1)],
    sports: [sports[Math.floor(Math.random() * sports.length)]],
    venue: venues[Math.floor(Math.random() * venues.length)],
    price: Math.floor(Math.random() * 2000) + 500,
    timestamp: date.toISOString(),
  };
};

// Generate 50 dummy bookings
export const dummyBookings: Booking[] = Array.from({ length: 50 }).map((_, i) => generateBooking(i + 1));
