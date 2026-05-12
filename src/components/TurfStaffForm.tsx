"use client";

import React, { useState } from "react";
import { Booking, MOCK_VENUES } from "@/lib/dummyData";
import { CheckCircle, Users } from "lucide-react";

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12.toString().padStart(2, "0")}:${m} ${ampm}`;
});

interface TurfStaffFormProps {
  venue?: typeof MOCK_VENUES[number];
  onBookingCreated?: () => void;
  onSubmit?: (booking: Omit<Booking, "id" | "timestamp">) => void;
}

const STAFF_NAMES = ["Rahul", "Suresh", "Amit", "Priya", "Nitin", "Other"];

export default function TurfStaffForm({ venue: initialVenue, onSubmit, onBookingCreated }: TurfStaffFormProps) {
  const [formData, setFormData] = useState({
    customerName: "",
    phoneNumber: "",

    date: new Date().toISOString().split('T')[0],
    bookingPlatform: "Offline" as "Online" | "Offline",
    platformName: "Playo",
    startTime: "06:00 PM",
    endTime: "07:00 PM",
    courtNumbers: [] as string[],
    sports: ["Cricket"],
    amountCollected: "",
    paymentMode: "GPay" as "GPay" | "Cash" | "PhonePe" | "UPI" | "App",
    staffName: "Rahul",
    venue: initialVenue || "Borivali",
    isCourtDropdownOpen: false,
  });
  const [submitted, setSubmitted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);

  const STAFF_PASSWORD = "welcome"; // Updated password for staff access

  // Persistence: Load session on mount
  React.useEffect(() => {
    const savedAuth = localStorage.getItem("staff_authenticated");
    if (savedAuth === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput.trim() === STAFF_PASSWORD) {
      setIsAuthenticated(true);
      localStorage.setItem("staff_authenticated", "true");
      setPasswordError(false);
    } else {
      setPasswordError(true);
    }
  };

  const parseTime12 = (time12: string) => {
    const [time, modifier] = time12.split(' ');
    let [hours, minutes] = time.split(':');
    if (hours === '12') hours = '00';
    if (modifier === 'PM') hours = (parseInt(hours, 10) + 12).toString();
    return `${hours.padStart(2, '0')}:${minutes}`;
  };

  const start = new Date(`1970-01-01T${parseTime12(formData.startTime)}:00`);
  const end = new Date(`1970-01-01T${parseTime12(formData.endTime)}:00`);
  let calculatedHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

  if (calculatedHours === 0) {
    calculatedHours = 24; // Same time means 24 hour booking
  } else if (calculatedHours < 0) {
    calculatedHours += 24; // Handle overnight bookings (e.g. 10 PM to 2 AM)
  }
  calculatedHours = calculatedHours || 1; // Fallback

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const primarySport = formData.sports[0] ?? "";

    // Generate prefixed court identifiers
    const prefixedCourts = formData.courtNumbers.map(n => {
      if (primarySport === 'Indoor Pitch' && !n.startsWith('IP')) return `IP${n}`;
      if (primarySport === 'Outdoor Pitch' && !n.startsWith('OP')) return `OP${n}`;
      if (['Cricket', 'Football', 'Turf'].includes(primarySport) && !n.startsWith('T')) return `T${n}`;
      if (primarySport === 'Pickleball' && !n.startsWith('PB')) return `PB${n}`;
      if (primarySport === 'Badminton' && !n.startsWith('C')) return `C${n}`;
      return n;
    });

    const bookingData = {
      ...formData,
      hours: calculatedHours,
      platformName: formData.bookingPlatform === "Online" ? formData.platformName : "Offline",
      courtNumbers: prefixedCourts,
      sports: formData.sports,
      amountCollected: parseFloat(formData.amountCollected) || 0,
      price: parseFloat(formData.amountCollected) || 0, // Map amountCollected to price for compatibility
      paymentMode: formData.paymentMode,
      staffName: formData.staffName,
      totalHours: calculatedHours * (formData.courtNumbers.length || 1),
    };

    if (onSubmit) {
      onSubmit(bookingData);
    } else {
      // Fallback: direct API call if onSubmit not provided (e.g. from page.tsx)
      await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newBookings: [{ ...bookingData, id: Date.now().toString(), timestamp: new Date().toISOString() }] })
      });
      if (onBookingCreated) onBookingCreated();
    }

    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setFormData({
        customerName: "",
        phoneNumber: "",
        date: new Date().toISOString().split('T')[0],
        bookingPlatform: "Offline",
        platformName: "Playo",
        startTime: "06:00 PM",
        endTime: "07:00 PM",
        courtNumbers: [] as string[],
        sports: ["Pickleball"],
        venue: initialVenue || "Borivali",
        amountCollected: "",
        paymentMode: "GPay",
        staffName: formData.staffName, // Keep staff name for next booking
        isCourtDropdownOpen: false,
      });
    }, 3000);
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-4 sm:p-8 rounded-xl sm:rounded-2xl shadow-lg sm:shadow-xl border border-gray-100">
      {!isAuthenticated ? (
        <div className="max-w-md mx-auto my-12 p-8 bg-white rounded-3xl shadow-xl border border-gray-100 animate-in fade-in zoom-in duration-500">
          <div className="text-center mb-8">
            <div className="inline-flex p-4 bg-blue-50 rounded-2xl text-blue-600 mb-4">
              <Users size={32} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Staff Portal</h2>
            <p className="text-gray-500 mt-2">Enter password to access booking form</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Password</label>
              <input
                type="password"
                className={`w-full px-4 py-3 rounded-xl border focus:ring-2 focus:border-transparent outline-none transition-all ${passwordError ? "border-red-500 focus:ring-red-200" : "border-gray-200 focus:ring-blue-500"
                  }`}
                placeholder="••••••••"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                required
              />
              {passwordError && (
                <p className="text-red-500 text-xs font-medium mt-1">Incorrect password. Please try again.</p>
              )}
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center space-x-2"
            >
              <span>Unlock Portal</span>
            </button>
          </form>
        </div>
      ) : submitted ? (
        <div className="flex flex-col items-center justify-center py-12 animate-in fade-in zoom-in duration-300">
          <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
          <h3 className="text-xl font-bold text-gray-800">Booking Saved Successfully!</h3>
          <p className="text-gray-500">The data has been synced to the system.</p>
        </div>
      ) : (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="mb-6 sm:mb-8 border-b pb-4">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800">New Booking Entry</h2>
            <p className="text-xs sm:text-sm text-gray-500">Venue: <span className="font-semibold text-blue-600">{formData.venue}</span></p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Customer Name</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={formData.customerName}
                  onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                  placeholder="e.g. Rahul Sharma"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Phone Number</label>
                <input
                  type="tel"
                  required
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={formData.phoneNumber}
                  onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                  placeholder="e.g. 9876543210"
                />
              </div>
              <div className="space-y-2 md:col-span-1">
                <label className="text-sm font-medium text-gray-700">Amount Collected (₹)</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="1"
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={formData.amountCollected}
                  onChange={(e) => setFormData({ ...formData, amountCollected: e.target.value })}
                  placeholder="e.g. 1500"
                />
              </div>

              <div className="space-y-2 md:col-span-1">
                <label className="text-sm font-medium text-gray-700">Payment Mode</label>
                <select
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={formData.paymentMode}
                  onChange={(e) => setFormData({ ...formData, paymentMode: e.target.value as any })}
                >
                  <option value="UPI">UPI</option>
                  <option value="Cash">Cash</option>
                  <option value="GPay">GPay</option>
                  <option value="PhonePe">PhonePe</option>
                  <option value="App Payment">App Payment</option>
                </select>
              </div>

              <div className="space-y-2 md:col-span-1">
                <label className="text-sm font-medium text-gray-700">Handled By (Staff)</label>
                <input
                  type="text"
                  required
                  placeholder="Enter staff name..."
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={formData.staffName}
                  onChange={(e) => setFormData({ ...formData, staffName: e.target.value })}
                />
              </div>

              <div className="space-y-2 md:col-span-1">
                <label className="text-sm font-medium text-gray-700">Venue</label>
                <select
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={formData.venue}
                  onChange={(e) => setFormData({ ...formData, venue: e.target.value as any, courtNumbers: [] })}
                >
                  <option value="Borivali">Borivali</option>
                  <option value="Baner">Baner</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Booking Platform</label>
                <select
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={formData.bookingPlatform}
                  onChange={(e) => setFormData({ ...formData, bookingPlatform: e.target.value as "Online" | "Offline" })}
                >
                  <option value="Offline">Offline / Walk-in</option>
                  <option value="Online">Online</option>
                </select>
              </div>

              {formData.bookingPlatform === "Online" && (
                <div className="space-y-2 animate-in slide-in-from-top-2 fade-in duration-200">
                  <label className="text-sm font-medium text-gray-700">Platform Name</label>
                  <select
                    required
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    value={formData.platformName}
                    onChange={(e) => setFormData({ ...formData, platformName: e.target.value })}
                  >
                    <option value="Playo">Playo</option>
                    <option value="Huddle">Huddle</option>
                    <option value="Khelomore">Khelomore</option>
                    <option value="Districs">Districs</option>
                    <option value="Playsport">Playsport</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              )}

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Sports (Select all that apply)</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  {["Pickleball", "Cricket", "Football", "Indoor Pitch", "Outdoor Pitch", "Badminton"].map(sport => (
                    <label key={sport} className="flex items-center space-x-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={formData.sports.includes(sport)}
                        onChange={() => {
                          const current = Array.isArray(formData.sports) ? formData.sports : [formData.sports];
                          const next = current.includes(sport)
                            ? current.filter(s => s !== sport)
                            : [...current, sport];
                          setFormData({ ...formData, sports: next as any });
                        }}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-600 group-hover:text-blue-600 transition-colors">{sport}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2 md:col-span-2 relative">
                <label className="text-sm font-medium text-gray-700">Select Units (Courts/Turfs/Pitches)</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, isCourtDropdownOpen: !prev.isCourtDropdownOpen }))}
                    className="w-full px-4 py-3 text-left bg-white rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all flex justify-between items-center"
                  >
                    <span className="block truncate text-gray-700">
                      {formData.courtNumbers.length > 0
                        ? formData.courtNumbers.join(', ')
                        : "Select units..."}
                    </span>
                    <span className="text-gray-400">▼</span>
                  </button>

                  {formData.isCourtDropdownOpen && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-80 overflow-auto p-2 space-y-4">
                      {formData.sports.length === 0 && (
                        <p className="text-center py-4 text-gray-400 text-xs italic">Please select a sport first</p>
                      )}

                      {formData.sports.includes('Cricket') || formData.sports.includes('Football') ? (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest px-2">Turf Units</p>
                          <div className="grid grid-cols-2 gap-2">
                            {[1, 2, 3, 4, 5, 6].map(n => {
                              const id = `T${n}`;
                              const isSelected = formData.courtNumbers.includes(id);
                              return (
                                <label key={id} className={`flex items-center p-3 rounded-xl border transition-all cursor-pointer ${isSelected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100 hover:border-gray-200'}`}>
                                  <input type="checkbox" checked={isSelected} className="hidden"
                                    onChange={() => setFormData(prev => ({ ...prev, courtNumbers: isSelected ? prev.courtNumbers.filter(c => c !== id) : [...prev.courtNumbers, id] }))}
                                  />
                                  <span className={`text-xs font-bold ${isSelected ? 'text-blue-700' : 'text-gray-600'}`}>Turf {n}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {formData.sports.includes('Indoor Pitch') && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-purple-600 uppercase tracking-widest px-2">Indoor Pitch</p>
                          <div className="grid grid-cols-2 gap-2">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
                              const id = `IP${n}`;
                              const isSelected = formData.courtNumbers.includes(id);
                              return (
                                <label key={id} className={`flex items-center p-3 rounded-xl border transition-all cursor-pointer ${isSelected ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-100 hover:border-gray-200'}`}>
                                  <input type="checkbox" checked={isSelected} className="hidden"
                                    onChange={() => setFormData(prev => ({ ...prev, courtNumbers: isSelected ? prev.courtNumbers.filter(c => c !== id) : [...prev.courtNumbers, id] }))}
                                  />
                                  <span className={`text-xs font-bold ${isSelected ? 'text-purple-700' : 'text-gray-600'}`}>Pitch {n}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {formData.sports.includes('Outdoor Pitch') && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest px-2">Outdoor Pitch</p>
                          <div className="grid grid-cols-2 gap-2">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
                              const id = `OP${n}`;
                              const isSelected = formData.courtNumbers.includes(id);
                              return (
                                <label key={id} className={`flex items-center p-3 rounded-xl border transition-all cursor-pointer ${isSelected ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100 hover:border-gray-200'}`}>
                                  <input type="checkbox" checked={isSelected} className="hidden"
                                    onChange={() => setFormData(prev => ({ ...prev, courtNumbers: isSelected ? prev.courtNumbers.filter(c => c !== id) : [...prev.courtNumbers, id] }))}
                                  />
                                  <span className={`text-xs font-bold ${isSelected ? 'text-emerald-700' : 'text-gray-600'}`}>OP {n}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {formData.sports.includes('Badminton') && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-pink-600 uppercase tracking-widest px-2">Badminton Courts</p>
                          <div className="grid grid-cols-2 gap-2">
                            {[1, 2, 3].map(n => {
                              const id = `C${n}`;
                              const isSelected = formData.courtNumbers.includes(id);
                              return (
                                <label key={id} className={`flex items-center p-3 rounded-xl border transition-all cursor-pointer ${isSelected ? 'bg-pink-50 border-pink-200' : 'bg-gray-50 border-gray-100 hover:border-gray-200'}`}>
                                  <input type="checkbox" checked={isSelected} className="hidden"
                                    onChange={() => setFormData(prev => ({ ...prev, courtNumbers: isSelected ? prev.courtNumbers.filter(c => c !== id) : [...prev.courtNumbers, id] }))}
                                  />
                                  <span className={`text-xs font-bold ${isSelected ? 'text-pink-700' : 'text-gray-600'}`}>Court {n}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {formData.sports.includes('Pickleball') && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest px-2">Pickleball</p>
                          <div className="grid grid-cols-3 gap-2">
                            {[1, 2, 3].map(n => {
                              const id = `PB${n}`;
                              const isSelected = formData.courtNumbers.includes(id);
                              return (
                                <label key={id} className={`flex items-center p-3 rounded-xl border transition-all cursor-pointer ${isSelected ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-100 hover:border-gray-200'}`}>
                                  <input type="checkbox" checked={isSelected} className="hidden"
                                    onChange={() => setFormData(prev => ({ ...prev, courtNumbers: isSelected ? prev.courtNumbers.filter(c => c !== id) : [...prev.courtNumbers, id] }))}
                                  />
                                  <span className={`text-xs font-bold ${isSelected ? 'text-orange-700' : 'text-gray-600'}`}>PB {n}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Invisible backdrop to close dropdown when clicking outside */}
                {formData.isCourtDropdownOpen && (
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setFormData(prev => ({ ...prev, isCourtDropdownOpen: false }))}
                  />
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Date</label>
                <input
                  type="date"
                  required
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Start Time</label>
                <select
                  required
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                >
                  {TIME_OPTIONS.map(time => <option key={time} value={time}>{time}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">End Time</label>
                <select
                  required
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                >
                  {TIME_OPTIONS.map(time => <option key={time} value={time}>{time}</option>)}
                </select>
              </div>


              <div className="md:col-span-2 bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-900">Booking Summary</p>
                  <p className="text-xs text-blue-700 mt-1">
                    {calculatedHours}h duration × {formData.courtNumbers.length || 1} units
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Total Facility Hours</p>
                  <div className="text-3xl font-bold text-blue-600">
                    {calculatedHours * (formData.courtNumbers.length || 1)}h
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg hover:shadow-blue-500/30 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
            >
              Save Booking
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
