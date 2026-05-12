"use client";

import React, { useState, useEffect } from "react";
import AdminDashboard from "@/components/AdminDashboard";
import TurfStaffForm from "@/components/TurfStaffForm";
import { Booking } from "@/lib/dummyData";
import { LayoutDashboard, PenLine, LogOut, Smartphone, TrendingUp } from "lucide-react";

type Role = "Admin" | "Staff";

export default function Home() {
  const [role, setRole] = useState<Role | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);

  // Persistence: Load role on mount
  useEffect(() => {
    const savedRole = localStorage.getItem("user_role") as Role | null;
    if (savedRole) {
      setRole(savedRole);
    }
    setIsInitializing(false);
  }, []);

  // Persistence: Save role when changed
  useEffect(() => {
    if (role) {
      localStorage.setItem("user_role", role);
    } else {
      localStorage.removeItem("user_role");
    }
  }, [role]);

  const fetchBookings = () => {
    setLoading(true);
    fetch('/api/bookings')
      .then(res => res.json())
      .then(data => {
        if (data.bookings) setBookings(data.bookings);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load bookings", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  const handleNewBooking = async (newBooking: Omit<Booking, "id" | "timestamp">) => {
    // Get the next serial number
    const lastId = bookings.length > 0 
      ? Math.max(...bookings.map(b => {
          const num = parseInt(b.id);
          return isNaN(num) ? 0 : num;
        })) 
      : 0;
    
    const booking: Booking = {
      ...newBooking,
      id: (lastId + 1).toString(),
      timestamp: new Date().toISOString(),
    };

    // Optimistic update
    setBookings((prev) => [booking, ...prev]);

    // Persist
    await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newBookings: [booking] })
    });
  };

  const handleUpload = async (newBookings: Booking[]) => {
    // Optimistic update
    setBookings((prev) => [...newBookings, ...prev]);

    // Persist
    await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newBookings })
    });
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  if (!role) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Decorative Background Elements */}
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-50 rounded-full blur-[120px] opacity-60"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-50 rounded-full blur-[120px] opacity-60"></div>

        <div className="max-w-md w-full z-10">
          <div className="bg-white/80 backdrop-blur-xl p-8 sm:p-12 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] border border-white/50 text-center animate-in fade-in slide-in-from-bottom-8 duration-700">
            
            <div className="mb-10 flex flex-col items-center">
              <div className="w-20 h-20 bg-white rounded-3xl shadow-xl flex items-center justify-center overflow-hidden mb-6 border border-gray-50 transform hover:scale-105 transition-transform duration-300">
                <img src="/brand-logo.png" alt="Force Logo" className="w-full h-full object-contain p-2" />
              </div>
              <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-2">Force Playing Field</h1>
              <p className="text-sm font-medium text-gray-400 uppercase tracking-[0.2em]">Management System</p>
            </div>

            <div className="space-y-4">
              <button
                onClick={() => setRole("Admin")}
                className="w-full group relative flex items-center justify-between bg-[#1a1a1a] hover:bg-black text-white py-5 px-8 rounded-2xl font-bold transition-all hover:shadow-2xl hover:shadow-black/20"
              >
                <div className="flex items-center space-x-4">
                  <div className="p-2 bg-white/10 rounded-lg group-hover:bg-white/20 transition-colors">
                    <LayoutDashboard size={22} className="text-blue-400" />
                  </div>
                  <span className="text-lg text-white">Admin Portal</span>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0 text-white">→</div>
              </button>

              <button
                onClick={() => setRole("Staff")}
                className="w-full group relative flex items-center justify-between bg-white hover:bg-blue-50 text-gray-900 py-5 px-8 rounded-2xl font-bold transition-all border-2 border-gray-100 hover:border-blue-200 shadow-sm hover:shadow-xl hover:shadow-blue-500/10"
              >
                <div className="flex items-center space-x-4">
                  <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
                    <Smartphone size={22} className="text-blue-600" />
                  </div>
                  <span className="text-lg text-gray-900">Staff Entry</span>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0 text-blue-600">→</div>
              </button>
            </div>

            <p className="mt-12 text-[10px] font-bold text-gray-300 uppercase tracking-[0.3em]">Premium Infrastructure v2.0</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-lg sm:rounded-xl flex items-center justify-center overflow-hidden border border-gray-100">
              <img 
                src="/brand-logo.png" 
                alt="Force Logo" 
                className="w-full h-full object-contain p-1"
              />
            </div>
            <div>
              <h1 className="text-base sm:text-xl font-black text-gray-900 tracking-tight line-clamp-1">FORCE PLAYING FIELD</h1>
              <p className="text-[8px] sm:text-[10px] uppercase tracking-[0.2em] text-blue-600 font-black">{role} View</p>
            </div>
          </div>

          <button
            onClick={() => {
              if (window.confirm("Exit to main menu?")) {
                setRole(null);
                localStorage.removeItem("admin_session");
                localStorage.removeItem("user_role");
                localStorage.removeItem("staff_authenticated");
              }
            }}
            className="flex items-center space-x-2 text-gray-400 hover:text-red-600 bg-white hover:bg-red-50 px-4 py-2 rounded-2xl transition-all text-xs font-black uppercase tracking-widest border border-gray-100 shadow-sm"
          >
            <LogOut size={16} />
            <span>Exit</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {role === "Admin" ? (
          <AdminDashboard bookings={bookings} onUpload={fetchBookings} />
        ) : (
          <TurfStaffForm onBookingCreated={fetchBookings} />
        )}
      </main>
    </div>
  );
}
