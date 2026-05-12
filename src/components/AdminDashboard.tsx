"use client";

import React, { useState, useMemo } from "react";
import { Booking, MOCK_VENUES } from "@/lib/dummyData";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
  Line,
  ComposedChart,
} from "recharts";
import {
  Users,
  Clock,
  TrendingUp,
  IndianRupee,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

const COLORS = ["#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#4F46E5"];

/** Parse Start Time from sheet (24h HH:MM) or legacy AM/PM strings → decimal hour [0,24) */
function parseStartHourTo24(timeStr: string | undefined): number | null {
  if (!timeStr || typeof timeStr !== "string") return null;
  const t = timeStr.trim();
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const m = parseInt(m24[2], 10);
    if (h > 23 || h < 0 || m > 59) return null;
    return h + m / 60;
  }
  const upper = t.toUpperCase().replace(/\./g, ":");
  const m = upper.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/);
  if (m) {
    let h = parseInt(m[1], 10);
    const mn = parseInt(m[2] || "0", 10);
    const ap = m[3];
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h + mn / 60;
  }
  const lead = t.match(/^(\d{1,2})/);
  if (!lead) return null;
  let h = parseInt(lead[1], 10);
  if (upper.includes("PM") && h < 12) h += 12;
  if (upper.includes("AM") && h === 12) h = 0;
  return h;
}

function hourDecimalToLabel(dec: number): string {
  const h = Math.floor(dec) % 24;
  const m = Math.round((dec % 1) * 60);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
}

/** Last 10 digits of phone. Returns "" if fewer than 10 digits — caller decides fallback. */
function normalizePhone(raw: string | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

/** Trim, title-case-ish normalization for free-text labels (sport, platform, name). */
function canonLabel(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

/** Collapse known sport variants so the pie reflects business categories, not typos. */
const SPORT_CANON: Record<string, string> = {
  "cricket/football": "Cricket / Football",
  "football/cricket": "Cricket / Football",
  "indoor cricket": "Indoor Cricket",
  "outdoor cricket": "Outdoor Cricket",
  "indoor/outdoor cricket": "Indoor / Outdoor Cricket",
  "outdoor/indoor cricket": "Indoor / Outdoor Cricket",
  pickleball: "Pickleball",
  badminton: "Badminton",
  futsal: "Futsal",
  "box cricket": "Box Cricket",
  tennis: "Tennis",
};

function canonSport(raw: string | undefined): string {
  const c = canonLabel(raw).toLowerCase();
  if (!c) return "Other";
  return SPORT_CANON[c] || canonLabel(raw);
}

/** Time string parses + end-after-start sanity. Returns null if row's time data is broken. */
function isTimeRowValid(startTime: string | undefined, endTime: string | undefined, hours: number | undefined): boolean {
  const s = parseStartHourTo24(startTime);
  if (s === null) return false;
  if (!hours || hours <= 0 || hours > 12) return false;
  if (endTime) {
    const e = parseStartHourTo24(endTime);
    // Allow end == 0 (midnight) or end > start; reject true backwards times.
    if (e !== null && e !== 0 && e < s && Math.abs(e - s) > 0.05) {
      // overnight wrap is fine ONLY if hours suggests it
      const wraps = s + hours > 24;
      if (!wraps) return false;
    }
  }
  return true;
}

interface AdminDashboardProps {
  bookings: Booking[];
  onUpload: (newBookings: Booking[]) => void;
}

export default function AdminDashboard({ bookings, onUpload }: AdminDashboardProps) {
  const [selectedVenue, setSelectedVenue] = useState<"All" | typeof MOCK_VENUES[number]>("All");
  const [timeRange, setTimeRange] = useState<"Today" | "Last 7 Days" | "This Month" | "Last Month" | "This Year" | "Last Year" | "All Time" | "Custom Range">("All Time");
  const [selectedDayOfWeek, setSelectedDayOfWeek] = useState<string>("All");
  const [startDate, setStartDate] = useState<string>("2024-01-01");
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);

  const ADMIN_PASSWORD = "Admin360";

  // Check for existing session
  React.useEffect(() => {
    const savedSession = localStorage.getItem("admin_session");
    if (savedSession === "active") {
      setIsAuthenticated(true);
    }
    setIsCheckingAuth(false);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput.trim() === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      setPasswordError(false);
      localStorage.setItem("admin_session", "active");
    } else {
      setPasswordError(true);
    }
  };

  // Filter bookings based on venue and timeRange
  const filteredBookings = useMemo(() => {
    let filtered = [...bookings].sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      
      // Stable sort for IDs (even if non-numeric like 'local-0')
      const idA = a.id || '';
      const idB = b.id || '';
      return idB.localeCompare(idA);
    });
    
    if (selectedVenue !== "All") {
      filtered = filtered.filter(b => b.venue === selectedVenue);
    }
    
    if (selectedDayOfWeek !== "All") {
      filtered = filtered.filter((b) => {
        const d = new Date((b.date || "") + "T12:00:00");
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        return days[d.getDay()] === selectedDayOfWeek;
      });
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    if (timeRange === "Today") {
      filtered = filtered.filter(b => b.date === todayStr);
    } else if (timeRange === "Last 7 Days") {
      const d = new Date(); d.setDate(d.getDate() - 6);
      filtered = filtered.filter(b => b.date >= d.toISOString().split('T')[0]);
    } else if (timeRange === "This Month") {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      filtered = filtered.filter(b => b.date >= d.toISOString().split('T')[0]);
    } else if (timeRange === "Last Month") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      filtered = filtered.filter(b => b.date >= start.toISOString().split('T')[0] && b.date <= end.toISOString().split('T')[0]);
    } else if (timeRange === "This Year") {
      const d = new Date(now.getFullYear(), 0, 1);
      filtered = filtered.filter(b => b.date >= d.toISOString().split('T')[0]);
    } else if (timeRange === "Last Year") {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() - 1, 11, 31);
      filtered = filtered.filter(b => b.date >= start.toISOString().split('T')[0] && b.date <= end.toISOString().split('T')[0]);
    } else if (timeRange === "Custom Range") {
      filtered = filtered.filter(b => b.date >= startDate && b.date <= endDate);
    }
    return filtered;
  }, [bookings, selectedVenue, timeRange, startDate, endDate, selectedDayOfWeek]);

  // Total booked hours (per row = sheet "Total Hours" for that booking — do not multiply by courts)
  const totalHours = useMemo(() => {
    return filteredBookings.reduce((acc, b) => acc + (b.hours || 0), 0);
  }, [filteredBookings]);
  const totalBookings = filteredBookings.length;
  const totalRevenue = filteredBookings.reduce((acc, curr) => acc + (curr.price || 0), 0);
  /** Paying rows only — strips ₹0 continuation lines so avg ticket isn't dragged down. */
  const paidBookings = useMemo(
    () => filteredBookings.filter((b) => (b.price || 0) > 0),
    [filteredBookings]
  );
  const paidRevenueCount = paidBookings.length;
  const avgTicketSize =
    paidRevenueCount > 0 ? Math.round(totalRevenue / paidRevenueCount) : 0;

  // Chart Data: Revenue trend — bucket size adapts to date span (daily vs monthly)
  const revenueTrendData = useMemo(() => {
    if (filteredBookings.length === 0) return [];

    const revByKey: Record<string, number> = {};
    const add = (key: string, amt: number) => {
      revByKey[key] = (revByKey[key] || 0) + amt;
    };

    if (timeRange === "All Time") {
      filteredBookings.forEach((b) => {
        const month = (b.date || "").substring(0, 7);
        if (month) add(month, b.price || 0);
      });
      return Object.entries(revByKey)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, revenue]) => ({
          date: new Date(month + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
          revenue,
          sortKey: month,
        }));
    }

    const dates = filteredBookings.map((b) => b.date).filter(Boolean).sort();
    const minD = dates[0];
    const maxD = dates[dates.length - 1];
    const spanDays =
      (new Date(maxD + "T12:00:00").getTime() - new Date(minD + "T12:00:00").getTime()) / 86400000 + 1;
    const monthly = spanDays > 60;

    filteredBookings.forEach((b) => {
      const d = b.date || "";
      if (!d) return;
      const key = monthly ? d.substring(0, 7) : d;
      add(key, b.price || 0);
    });

    return Object.entries(revByKey)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, revenue]) => ({
        date: monthly
          ? new Date(key + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" })
          : new Date(key + "T12:00:00").toLocaleDateString("en-IN", {
              weekday: spanDays > 14 ? undefined : "short",
              day: "numeric",
              month: "short",
            }),
        revenue,
        sortKey: key,
      }));
  }, [filteredBookings, timeRange]);

  /** Last bucket vs prior — quick pulse for KPI chip */
  const trendVsPriorPct = useMemo(() => {
    if (revenueTrendData.length < 2) return null;
    const last = revenueTrendData[revenueTrendData.length - 1].revenue;
    const prev = revenueTrendData[revenueTrendData.length - 2].revenue;
    if (prev === 0) return last > 0 ? 100 : 0;
    return ((last - prev) / prev) * 100;
  }, [revenueTrendData]);

  // Chart Data: Bookings by Sport (canonicalized — same sport written 3 ways is now ONE slice)
  const sportsData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredBookings.forEach((b) => {
      const s = canonSport(b.sports?.[0]);
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredBookings]);

  // Chart Data: Platform Share (Detailed by Source)
  const platformData = useMemo(() => {
    const counts: Record<string, { count: number, revenue: number }> = {};
    filteredBookings.forEach(b => {
      const source = (b.platformName || "Direct").trim() || "Direct";
      if (!counts[source]) counts[source] = { count: 0, revenue: 0 };
      counts[source].count += 1;
      counts[source].revenue += (b.price || 0);
    });
    return Object.keys(counts).map(name => ({ 
      name, 
      value: counts[name].count,
      revenue: counts[name].revenue 
    })).sort((a,b) => b.value - a.value);
  }, [filteredBookings]);

  // Weekday vs Weekend Split
  const daySplitData = useMemo(() => {
    const split = { Weekday: 0, Weekend: 0 };
    filteredBookings.forEach((b) => {
      const day = new Date((b.date || "") + "T12:00:00").getDay();
      if (day === 0 || day === 6) split.Weekend += b.price || 0;
      else split.Weekday += b.price || 0;
    });
    return Object.entries(split).map(([name, value]) => ({ name, value }));
  }, [filteredBookings]);

  const venueRevenueData = useMemo(() => {
    const m: Record<string, { revenue: number; hours: number; bookings: number }> = {};
    filteredBookings.forEach((b) => {
      const v = b.venue || "Unknown";
      if (!m[v]) m[v] = { revenue: 0, hours: 0, bookings: 0 };
      m[v].revenue += b.price || 0;
      m[v].hours += b.hours || 0;
      m[v].bookings += 1;
    });
    return Object.entries(m)
      .map(([venue, d]) => ({
        venue,
        ...d,
        avgTicket: d.bookings ? Math.round(d.revenue / d.bookings) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredBookings]);

  const channelMixData = useMemo(() => {
    let onR = 0,
      offR = 0,
      onC = 0,
      offC = 0;
    filteredBookings.forEach((b) => {
      if (b.bookingPlatform === "Online") {
        onR += b.price || 0;
        onC += 1;
      } else {
        offR += b.price || 0;
        offC += 1;
      }
    });
    return [
      { name: "Online", value: onC, revenue: onR },
      { name: "Offline", value: offC, revenue: offR },
    ].filter((x) => x.value > 0);
  }, [filteredBookings]);

  const weekdayRevenueData = useMemo(() => {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const sums = [0, 0, 0, 0, 0, 0, 0];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    filteredBookings.forEach((b) => {
      const d = new Date((b.date || "") + "T12:00:00").getDay();
      const idx = d === 0 ? 6 : d - 1;
      sums[idx] += b.price || 0;
      counts[idx] += 1;
    });
    return labels.map((day, i) => ({
      day,
      revenue: sums[i],
      bookings: counts[i],
    }));
  }, [filteredBookings]);

  // Chart Data: Peak Hours — booked hours per clock hour (6am–11pm window)
  // For each booking, we compute its real overlap with every hour window [h, h+1).
  // Handles fractional durations (e.g. 1.5h) and overnight wrap (end > 24).
  const peakHoursData = useMemo(() => {
    const HOUR_START = 6;
    const HOUR_END = 23; // inclusive → covers windows [6,7) … [23,24)
    const occHours: Record<number, number> = {};
    const occBookings: Record<number, number> = {};
    for (let h = HOUR_START; h <= HOUR_END; h++) {
      occHours[h] = 0;
      occBookings[h] = 0;
    }

    const addOverlap = (start: number, end: number) => {
      if (end <= start) return;
      for (let h = HOUR_START; h <= HOUR_END; h++) {
        const overlap = Math.max(0, Math.min(end, h + 1) - Math.max(start, h));
        if (overlap > 0) {
          occHours[h] += overlap;
          occBookings[h] += 1;
        }
      }
    };

    filteredBookings.forEach((b) => {
      if (!isTimeRowValid(b.startTime, b.endTime, b.hours)) return;
      const start = parseStartHourTo24(b.startTime);
      if (start === null) return;
      const end = start + b.hours;
      if (end <= 24) {
        addOverlap(start, end);
      } else {
        addOverlap(start, 24);
        addOverlap(0, end - 24);
      }
    });

    return Object.keys(occHours)
      .map(Number)
      .sort((a, b) => a - b)
      .map((h) => ({
        hour: hourDecimalToLabel(h),
        hourKey: h,
        count: Math.round(occHours[h] * 10) / 10,
        bookings: occBookings[h],
      }));
  }, [filteredBookings]);

  const busiestHours = useMemo(() => {
    return [...peakHoursData].sort((a, b) => b.count - a.count).filter((h) => h.count > 0).slice(0, 3);
  }, [peakHoursData]);

  const onlineSharePct =
    totalBookings > 0
      ? Math.round((filteredBookings.filter((b) => b.bookingPlatform === "Online").length / totalBookings) * 100)
      : 0;

  // Chart Data: Sports Popularity
  const sportData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredBookings.forEach(b => {
      (b.sports || []).forEach(s => {
        counts[s] = (counts[s] || 0) + 1;
      });
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredBookings]);

  // Detailed Court Utilization by Category
  const infrastructureUtilization = useMemo(() => {
    const categories: Record<string, { totalHours: number, bookings: number, courts: Set<string> }> = {
      'T-Turfs (T1-T6)': { totalHours: 0, bookings: 0, courts: new Set() },
      'Indoor (IP1-IP6)': { totalHours: 0, bookings: 0, courts: new Set() },
      'Outdoor (OP)': { totalHours: 0, bookings: 0, courts: new Set() },
      'Pickleball/Others': { totalHours: 0, bookings: 0, courts: new Set() }
    };

    filteredBookings.forEach(b => {
      (b.courtNumbers || []).forEach(c => {
        if (!c) return;
        const uc = c.toUpperCase();
        let cat = 'Pickleball/Others';
        if (uc.startsWith('T')) cat = 'T-Turfs (T1-T6)';
        else if (uc.startsWith('IP')) cat = 'Indoor (IP1-IP6)';
        else if (uc.startsWith('OP')) cat = 'Outdoor (OP)';
        
        categories[cat].totalHours += (b.hours / (b.courtNumbers?.length || 1));
        categories[cat].bookings += 1;
        categories[cat].courts.add(uc);
      });
    });

    return Object.entries(categories).map(([name, data]) => ({
      name,
      hours: Math.round(data.totalHours),
      bookings: data.bookings,
      uniqueCourts: data.courts.size
    })).filter(d => d.bookings > 0);
  }, [filteredBookings]);

  // Individual Court-by-Court Stats
  const courtDetailedStats = useMemo(() => {
    const stats: Record<string, { hours: number, bookings: number, type: string }> = {};
    
    filteredBookings.forEach(b => {
      (b.courtNumbers || []).forEach(c => {
        if (!c) return;
        const uc = c.toUpperCase().trim();
        if (!stats[uc]) {
          let type = 'Other';
          if (uc.startsWith('T')) type = 'Turf';
          else if (uc.startsWith('IP')) type = 'Indoor';
          else if (uc.startsWith('OP')) type = 'Outdoor';
          else if (uc.startsWith('PB')) type = 'Pickleball';
          else if (uc.startsWith('C')) type = 'Court';
          stats[uc] = { hours: 0, bookings: 0, type };
        }
        stats[uc].hours += b.hours; // Add full duration to each court
        stats[uc].bookings += 1;
      });
    });

    return Object.entries(stats)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => {
        // Sort by type then name
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });
  }, [filteredBookings]);

  // Analytics: Customer loyalty in current filter (dedupe by phone when present)
  const customerAnalytics = useMemo(() => {
    const stats: Record<
      string,
      {
        id: string;
        name: string;
        phoneNumber: string;
        visits: number;
        totalHours: number;
        totalSpent: number;
        lastVisit: string;
      }
    > = {};

    filteredBookings.forEach((b) => {
      // Phone normalized to last 10 digits → merges "9821313555" and "+91 98213 13555".
      const phone = normalizePhone(b.phoneNumber);
      // No usable phone: one row per booking so duplicate names stay separate.
      const key =
        phone
          ? phone
          : `${(b.customerName || "").trim().toLowerCase() || "guest"}__${b.id}`;
      if (!stats[key]) {
        stats[key] = {
          id: key,
          name: b.customerName,
          phoneNumber: b.phoneNumber,
          visits: 0,
          totalHours: 0,
          totalSpent: 0,
          lastVisit: b.date,
        };
      }
      stats[key].visits += 1;
      stats[key].totalHours += b.hours || 0;
      stats[key].totalSpent += b.price || 0;
      if (new Date(b.date + "T12:00:00") > new Date(stats[key].lastVisit + "T12:00:00")) {
        stats[key].lastVisit = b.date;
      }
    });

    return Object.values(stats).sort((a, b) => b.visits - a.visits);
  }, [filteredBookings]);

  // Business Development Metrics
  const bizDevMetrics = useMemo(() => {
    if (bookings.length === 0) return { growth: 0, utilization: 0, retentionRate: 0, currentMonthRev: 0 };

    // Get the most recent month present in the data
    const sortedDates = [...bookings].map(b => b.date).filter(Boolean).sort();
    const lastDateInData = sortedDates[sortedDates.length - 1];
    if (!lastDateInData) return { growth: 0, utilization: 0, retentionRate: 0, currentMonthRev: 0 };
    
    const currentMonth = lastDateInData.substring(0, 7); // YYYY-MM
    const lastMonthDate = new Date(currentMonth + "-01");
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonth = lastMonthDate.toISOString().substring(0, 7);

    const currentMonthRev = bookings.filter(b => (b.date || '').startsWith(currentMonth)).reduce((acc, b) => acc + (b.price || 0), 0);
    const lastMonthRev = bookings.filter(b => (b.date || '').startsWith(lastMonth)).reduce((acc, b) => acc + (b.price || 0), 0);
    
    const growth = lastMonthRev > 0 ? ((currentMonthRev - lastMonthRev) / lastMonthRev) * 100 : 0;
    
    // Utilization (Calculate actual capacity based on unique courts found in the data)
    const uniqueCourts = new Set();
    filteredBookings.forEach(b => (b.courtNumbers || []).forEach(c => uniqueCourts.add(c)));
    const actualCourtCount = uniqueCourts.size || (selectedVenue === "Baner" ? 6 : 13);
    
    const totalDays = [...new Set(filteredBookings.map(b => b.date))].length || 1;
    const capacity = totalDays * actualCourtCount * 15; // 15h per day
    const utilization = capacity > 0 ? (totalHours / capacity) * 100 : 0;

    // Retention
    const repeatCustomers = customerAnalytics.filter(c => c.visits > 1).length;
    const retentionRate = customerAnalytics.length > 0 ? (repeatCustomers / customerAnalytics.length) * 100 : 0;

    return { growth, utilization, retentionRate, currentMonthRev, currentMonthLabel: new Date(currentMonth + "-01").toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }, [bookings, filteredBookings, totalHours, customerAnalytics, selectedVenue]);

  const getLoyaltyStatus = (visits: number) => {
    if (visits >= 20) return { label: 'ELITE VIP', color: 'text-purple-600 bg-purple-50' };
    if (visits >= 10) return { label: 'GOLD MEMBER', color: 'text-amber-600 bg-amber-50' };
    return { label: 'REGULAR', color: 'text-blue-600 bg-blue-50' };
  };

  if (isCheckingAuth) return null; // MOVED AFTER HOOKS TO FIX REACT ERROR

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-4 sm:mx-auto my-8 sm:my-12 p-5 sm:p-8 bg-white rounded-3xl shadow-xl border border-gray-100 animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex p-4 bg-purple-50 rounded-2xl text-purple-600 mb-4">
            <TrendingUp size={32} />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Admin Login</h2>
          <p className="text-gray-500 mt-2">Secure access for business analytics</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Admin Password</label>
            <input
              type="password"
              className={`w-full px-4 py-3 rounded-xl border focus:ring-2 focus:border-transparent outline-none transition-all ${
                passwordError ? "border-red-500 focus:ring-red-200" : "border-gray-200 focus:ring-purple-500"
              }`}
              placeholder="••••••••"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              required
            />
            {passwordError && <p className="text-red-500 text-xs font-medium mt-1">Incorrect admin password.</p>}
          </div>
          <button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-purple-500/20 flex items-center justify-center space-x-2">
            <span>Enter Dashboard</span>
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-700">
      {/* Premium Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-end gap-4 sm:gap-6 bg-white p-4 sm:p-6 lg:p-8 rounded-3xl sm:rounded-[2.5rem] shadow-sm border border-gray-100">
        <div className="flex flex-wrap items-end gap-4 sm:gap-6 w-full">
          <div className="space-y-1.5 flex-1 min-w-[140px]">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Select Venue</label>
            <select 
              value={selectedVenue} 
              onChange={(e) => setSelectedVenue(e.target.value as any)}
              className="w-full bg-gray-50 border-none text-sm font-bold py-3 px-4 sm:px-5 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer block"
            >
              <option value="All">Global Overview</option>
              {MOCK_VENUES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div className="space-y-1.5 w-full md:flex-[2] md:min-w-[320px]">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Time Range</label>
            <div className="flex flex-wrap bg-gray-50 p-1.5 rounded-2xl gap-1">
              {(["Today", "Last 7 Days", "This Month", "Last Month", "This Year", "Last Year", "All Time", "Custom Range"] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-2.5 sm:px-4 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-black rounded-xl transition-all uppercase tracking-wider whitespace-nowrap ${
                    timeRange === range ? "bg-white text-blue-600 shadow-sm" : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 flex-1 min-w-[140px]">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Specific Day</label>
            <select 
              value={selectedDayOfWeek} 
              onChange={(e) => setSelectedDayOfWeek(e.target.value)}
              className="w-full bg-gray-50 border-none text-[10px] font-black py-3 px-4 sm:px-5 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer block uppercase tracking-widest"
            >
              <option value="All">All Days</option>
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {timeRange === "Custom Range" && (
            <div className="flex flex-wrap items-end gap-3 sm:gap-4 w-full animate-in slide-in-from-right-4 duration-300">
              <div className="space-y-1.5 flex-1 min-w-[140px]">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">From</label>
                <input 
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-gray-50 border-none text-sm font-bold py-3 px-4 sm:px-5 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none block"
                />
              </div>
              <div className="space-y-1.5 flex-1 min-w-[140px]">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">To</label>
                <input 
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-gray-50 border-none text-sm font-bold py-3 px-4 sm:px-5 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none block"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-blue-500/5 transition-all group">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <div className="p-3 sm:p-4 bg-blue-50 text-blue-600 rounded-2xl sm:rounded-[1.5rem] group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
              <IndianRupee className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div className="text-right">
              {trendVsPriorPct === null ? (
                <span className="text-[10px] font-black text-gray-400 bg-gray-50 px-3 py-1 rounded-full">vs prior</span>
              ) : (
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] font-black px-3 py-1 rounded-full ${
                    trendVsPriorPct >= 0 ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50"
                  }`}
                >
                  {trendVsPriorPct >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  {trendVsPriorPct >= 0 ? "+" : ""}
                  {trendVsPriorPct.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Net Revenue</p>
          <h3 className="text-2xl sm:text-3xl lg:text-4xl font-black text-gray-900 mt-2 break-all">₹{(totalRevenue || 0).toLocaleString()}</h3>
          <p className="text-[9px] font-bold text-gray-400 mt-2 uppercase tracking-widest">
            Last period vs previous bucket in chart
          </p>
        </div>

        <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-purple-500/5 transition-all group">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <div className="p-3 sm:p-4 bg-purple-50 text-purple-600 rounded-2xl sm:rounded-[1.5rem] group-hover:bg-purple-600 group-hover:text-white transition-all duration-300">
              <Users className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div className="text-right">
              <span className="text-[10px] font-black text-purple-500 bg-purple-50 px-3 py-1 rounded-full">{totalBookings} total</span>
            </div>
          </div>
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Active Players</p>
          <h3 className="text-2xl sm:text-3xl lg:text-4xl font-black text-gray-900 mt-2">{totalBookings}</h3>
        </div>

        <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-emerald-500/5 transition-all group">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <div className="p-3 sm:p-4 bg-emerald-50 text-emerald-600 rounded-2xl sm:rounded-[1.5rem] group-hover:bg-emerald-600 group-hover:text-white transition-all duration-300">
              <Clock className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div className="text-right">
              <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-3 py-1 rounded-full">
                Avg ₹{avgTicketSize.toLocaleString("en-IN")} · paid
              </span>
            </div>
          </div>
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Hours Played</p>
          <h3 className="text-2xl sm:text-3xl lg:text-4xl font-black text-gray-900 mt-2">{totalHours}</h3>
          <p className="text-[9px] font-bold text-gray-400 mt-2 uppercase tracking-widest">
            Avg ticket from {paidRevenueCount.toLocaleString("en-IN")} paid bookings
          </p>
        </div>

        <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-amber-500/5 transition-all group overflow-hidden relative">
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Top Customers</h4>
          <div className="space-y-3">
            {customerAnalytics.slice(0, 3).map((customer, idx) => (
              <div key={customer.id} className="flex items-center justify-between gap-2">
                <div className="flex items-center space-x-3 min-w-0">
                  <div className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center text-[10px] font-black ${
                    idx === 0 ? 'bg-amber-100 text-amber-600' : 
                    idx === 1 ? 'bg-slate-100 text-slate-600' : 
                    'bg-orange-100 text-orange-600'
                  }`}>
                    {idx + 1}
                  </div>
                  <span className="text-xs font-black text-gray-900 truncate">{customer.name}</span>
                </div>
                <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-md whitespace-nowrap">{customer.visits} visits</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        <div className="lg:col-span-2 bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm">
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6">Revenue by venue</h4>
          <div className="h-[220px] sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={venueRevenueData} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="venue"
                  width={100}
                  tick={{ fontSize: 10, fontWeight: 800, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value, name) => {
                    const raw = Array.isArray(value) ? value[0] : value;
                    const n = Number(raw ?? 0);
                    return name === "revenue"
                      ? [`₹${n.toLocaleString("en-IN")}`, "Revenue"]
                      : [n, String(name ?? "")];
                  }}
                  contentStyle={{ borderRadius: "16px", border: "none", fontWeight: "bold" }}
                />
                <Bar dataKey="revenue" fill="#2563EB" radius={[0, 8, 8, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm">
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Channel mix</h4>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={channelMixData} innerRadius={55} outerRadius={85} paddingAngle={4} dataKey="value" stroke="none">
                  {channelMixData.map((entry) => (
                    <Cell key={entry.name} fill={entry.name === "Online" ? "#10b981" : "#f97316"} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name, item) => {
                    const count = Number((Array.isArray(value) ? value[0] : value) ?? 0);
                    const payload = item && typeof item === "object" && "payload" in item ? (item as { payload?: { revenue?: number } }).payload : undefined;
                    const rev = Number(payload?.revenue ?? 0);
                    return [`${count} bookings · ₹${rev.toLocaleString("en-IN")}`, String(name ?? "")];
                  }}
                  contentStyle={{ borderRadius: "16px", border: "none", fontWeight: "bold" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 mt-2">
            {channelMixData.map((c, i) => (
              <div key={`${c.name}-${i}`} className="text-center">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{c.name}</p>
                <p className="text-sm font-black text-gray-900">{c.value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="lg:col-span-3 bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm">
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6">Revenue by weekday</h4>
          <div className="h-[200px] sm:h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdayRevenueData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fontWeight: 800, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  formatter={(value) => {
                    const raw = Array.isArray(value) ? value[0] : value;
                    return [`₹${Number(raw ?? 0).toLocaleString("en-IN")}`, "Revenue"];
                  }}
                  contentStyle={{ borderRadius: "16px", border: "none", fontWeight: "bold" }}
                />
                <Bar dataKey="revenue" fill="#7c3aed" radius={[8, 8, 0, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Analytics Visualization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        <div className="lg:col-span-2 bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[3rem] border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-6 sm:mb-10 gap-3">
            <h3 className="text-base sm:text-xl font-black text-gray-900">Revenue Performance</h3>
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
              <span className="hidden sm:inline text-[10px] font-black text-gray-400 uppercase tracking-widest">Real-time Analytics</span>
            </div>
          </div>
          <div className="h-[260px] sm:h-[320px] lg:h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={revenueTrendData}>
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.9}/>
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}} dy={15} />
                <YAxis hide />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', padding: '15px'}}
                />
                <Bar dataKey="revenue" fill="url(#barGradient)" radius={[12, 12, 0, 0]} barSize={45} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#1e3a8a"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#1e3a8a", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Distribution Analysis */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 lg:col-span-3">
          {/* Sport Distribution */}
          <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-blue-500/5 transition-all">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6 sm:mb-8">Sport Distribution</h4>
            <div className="h-[220px] sm:h-[260px] lg:h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sportsData}
                    innerRadius={80}
                    outerRadius={110}
                    paddingAngle={8}
                    dataKey="value"
                    stroke="none"
                  >
                    {sportsData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', fontWeight: 'bold' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-4 justify-center mt-4">
              {sportsData.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center space-x-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{item.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Platform Distribution */}
          <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-orange-500/5 transition-all">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Platform Distribution</h4>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black text-orange-600 bg-orange-50 px-2 py-1 rounded-md">
                {onlineSharePct}% Online
              </span>
            </div>
            <div className="h-[220px] sm:h-[260px] lg:h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={platformData}
                    innerRadius={70}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {platformData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.name === 'WhatsApp' ? '#94a3b8' : COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value, name, props) => [`${value} bookings (₹${(props.payload.revenue || 0).toLocaleString()})`, name]}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', fontWeight: 'bold' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2">
              {platformData.slice(0, 4).map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.name === 'WhatsApp' ? '#94a3b8' : COLORS[index % COLORS.length] }}></div>
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{item.name}</span>
                  </div>
                  <span className="text-[10px] font-black text-gray-900">₹{Math.round(item.revenue/1000)}K</span>
                </div>
              ))}
            </div>
          </div>

          {/* Peak Hours Analysis */}
          <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-emerald-500/5 transition-all sm:col-span-2 lg:col-span-1">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Peak Operating Hours</h4>
            <div className="flex flex-wrap items-center gap-2 mb-6 sm:mb-8">
              <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
                Morning: 7 AM - 12 PM
              </span>
              <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                Prime Time: 6 PM - 11 PM
              </span>
              {busiestHours.length > 0 && (
                <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-md animate-pulse">
                  Current Peak: {busiestHours[0].hour} · {busiestHours[0].count.toLocaleString("en-IN")} hrs
                </span>
              )}
            </div>
            <div className="h-[220px] sm:h-[260px] lg:h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={peakHoursData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis 
                    dataKey="hour" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }}
                  />
                  <Tooltip
                    cursor={{ fill: '#f8fafc', radius: 10 }}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', fontWeight: 'bold' }}
                    formatter={(value, _name, item) => {
                      const v = Number((Array.isArray(value) ? value[0] : value) ?? 0);
                      const payload = item && typeof item === "object" && "payload" in item
                        ? (item as { payload?: { bookings?: number } }).payload
                        : undefined;
                      const bk = payload?.bookings ?? 0;
                      return [`${v.toLocaleString("en-IN")} hrs · ${bk} bookings`, "Occupancy"];
                    }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={20}>
                    {peakHoursData.map((entry, index) => {
                      const hk = entry.hourKey;
                      const isPeak = busiestHours.some((h) => h.hourKey === hk);
                      const isPrime = hk >= 18 && hk <= 23;
                      const isMorning = hk >= 7 && hk <= 12;
                      return (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            isPeak && entry.count > 0
                              ? "#f59e0b"
                              : isPrime && entry.count > 0
                                ? "#10b981"
                                : isMorning && entry.count > 0
                                  ? "#3b82f6"
                                  : "#e2e8f0"
                          }
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-center text-[10px] font-black text-gray-400 uppercase tracking-widest mt-4">Hourly Occupancy Volume</p>
          </div>

        </div>
      </div>

        {/* Turf Intelligence Section */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 mb-8 sm:mb-12">
          {/* Sport Popularity */}
          <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-purple-500/5 transition-all">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6 sm:mb-8">Popular Sports</h4>
            <div className="h-[220px] sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sportData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                    {sportData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', fontWeight: 'bold' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {sportData.map((s, i) => (
                <span key={`${s.name}-${i}`} className="px-3 py-1 bg-gray-50 rounded-full text-[8px] font-black text-gray-500 uppercase tracking-widest border border-gray-100">
                  {s.name}: {s.value}
                </span>
              ))}
            </div>
          </div>

          {/* Facility Infrastructure Utilization */}
          <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-blue-500/5 transition-all sm:col-span-2 lg:col-span-1">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6 sm:mb-8">Infrastructure Utilization</h4>
            <div className="space-y-5 sm:space-y-6">
              {infrastructureUtilization.map((cat, idx) => (
                <div key={cat.name} className="space-y-2">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-[10px] font-black text-gray-900 uppercase tracking-widest">{cat.name}</p>
                      <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">{cat.uniqueCourts} Active Units</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-blue-600">{cat.hours} hrs</p>
                      <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">{cat.bookings} bookings</p>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-50 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${idx === 0 ? 'bg-blue-500' : idx === 1 ? 'bg-purple-500' : 'bg-emerald-500'}`} 
                      style={{ width: `${Math.min((cat.hours / (cat.uniqueCourts * 15 * 7)) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-center text-[10px] font-black text-gray-400 uppercase tracking-widest mt-8">Capacity based on 15h Daily Operation</p>
          </div>

          {/* Revenue Split */}
          <div className="bg-white p-5 sm:p-7 lg:p-8 rounded-3xl sm:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-emerald-500/5 transition-all">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6 sm:mb-8">Weekday vs Weekend</h4>
            <div className="h-[220px] sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={daySplitData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                    <Cell fill="#94a3b8" />
                    <Cell fill="#10b981" />
                  </Pie>
                  <Tooltip
                    formatter={(value) => {
                      const raw = Array.isArray(value) ? value[0] : value;
                      return `₹${Number(raw ?? 0).toLocaleString()}`;
                    }}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', fontWeight: 'bold' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-8 flex justify-around">
              {daySplitData.map((d, i) => (
                <div key={d.name} className="text-center">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{d.name}</p>
                  <p className="text-sm font-black text-gray-900 mt-1">₹{Math.round(d.value/100000)}L</p>
                </div>
              ))}
            </div>
          </div>
        </div>


      {/* Customer Intelligence Leaderboard */}
      <div className="bg-white p-5 sm:p-8 lg:p-10 rounded-3xl sm:rounded-[3rem] border border-gray-100 shadow-sm overflow-hidden mt-6 sm:mt-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-10">
          <div>
            <h3 className="text-lg sm:text-xl font-black text-gray-900">Customer Intelligence</h3>
            <p className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Lifetime Value &amp; Loyalty Analysis</p>
          </div>
          <div className="self-start sm:self-auto px-5 sm:px-6 py-2.5 sm:py-3 bg-blue-50 text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] rounded-2xl">
            {customerAnalytics.length} Unique Customers
          </div>
        </div>
        <div className="overflow-x-auto -mx-5 px-5 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10 pb-4">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pb-6 pr-8 text-[10px] font-black text-gray-400 uppercase tracking-widest">Customer Profile</th>
                <th className="pb-6 pr-8 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                <th className="pb-6 pr-8 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Total Visits</th>
                <th className="pb-6 pr-8 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Hours Invested</th>
                <th className="pb-6 pr-8 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Latest Activity</th>
                <th className="pb-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Lifetime Value</th>
              </tr>
            </thead>
            <tbody>
              {customerAnalytics.slice(0, 10).map((c) => {
                const status = getLoyaltyStatus(c.visits);
                return (
                  <tr key={c.id} className="group hover:bg-gray-50/50 transition-all">
                    <td className="py-6 pr-8 border-b border-gray-50 group-last:border-0">
                      <div className="flex items-center space-x-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-black shadow-sm ${
                          c.visits >= 20 ? 'bg-purple-600 text-white' : 
                          c.visits >= 10 ? 'bg-amber-400 text-white' : 'bg-blue-600 text-white'
                        }`}>
                          {c.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-black text-gray-900">{c.name}</p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">{c.phoneNumber}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-6 pr-8 border-b border-gray-50 group-last:border-0 text-center">
                      <span className={`text-[9px] font-black px-3 py-1.5 rounded-lg tracking-widest ${status.color}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="py-6 pr-8 border-b border-gray-50 group-last:border-0 text-center">
                      <p className="text-sm font-black text-gray-900">{c.visits}</p>
                      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Sessions</p>
                    </td>
                    <td className="py-6 pr-8 border-b border-gray-50 group-last:border-0 text-center">
                      <p className="text-sm font-black text-gray-900">{c.totalHours}</p>
                      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Hours</p>
                    </td>
                    <td className="py-6 pr-8 border-b border-gray-50 group-last:border-0 text-center">
                      <p className="text-[10px] font-black text-gray-900 uppercase">{c.lastVisit}</p>
                    </td>
                    <td className="py-6 border-b border-gray-50 group-last:border-0 text-right">
                      <p className="text-sm font-black text-gray-900">₹{(c.totalSpent || 0).toLocaleString()}</p>
                      <p className="text-[9px] text-emerald-600 font-black uppercase tracking-widest">Revenue</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
