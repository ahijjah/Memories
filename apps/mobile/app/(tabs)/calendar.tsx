import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getAuthenticatedClient } from '@/src/api/client';

interface CalendarItem {
  memoryId: string;
  date: string;
  title: string;
  type?: string;
  assets: Array<{ id: string; mimeType: string; variant?: string }>;
}

interface CalendarMonthResponse {
  month: string;
  items: CalendarItem[];
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

// Safe date-only formatting without timezone conversion
function formatDateOnly(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) return dateStr;

  // Use local Date constructor to avoid UTC parsing
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function CalendarScreen() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  // Fetch calendar data for the current month
  const { data: calendarData, isLoading, error } = useQuery({
    queryKey: ['calendar', monthStr],
    queryFn: async () => {
      const client = await getAuthenticatedClient();
      const response = await client.get<CalendarMonthResponse>(
        `/engagement/calendar?month=${monthStr}`
      );
      return response.data;
    },
  });

  useEffect(() => {
    if (calendarData?.items) {
      setSelectedDate(null);
    }
  }, [calendarData?.items]);

  // Get set of dates that have memories
  const datedDays = new Set<string>();
  if (calendarData?.items) {
    calendarData.items.forEach((item) => {
      datedDays.add(item.date);
    });
  }

  // Get memories for the selected date
  const selectedDayMemories = selectedDate
    ? (calendarData?.items || []).filter((item) => item.date === selectedDate)
    : [];

  const daysInCurrentMonth = getDaysInMonth(year, month);
  const firstDayOfWeek = getFirstDayOfMonth(year, month);

  // Generate calendar grid
  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarDays.push(null); // Empty cells before month starts
  }
  for (let day = 1; day <= daysInCurrentMonth; day++) {
    calendarDays.push(day);
  }

  const handlePrevMonth = () => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() - 1);
    setCurrentDate(newDate);
  };

  const handleNextMonth = () => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + 1);
    setCurrentDate(newDate);
  };

  const handleDayPress = (day: number) => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(dateStr);
  };

  const handleMemoryPress = (memoryId: string) => {
    router.push(`/memory/${memoryId}`);
  };

  if (error) {
    return (
      <View className="flex-1 bg-white justify-center items-center px-6">
        <Text className="text-red-600 text-center">
          Failed to load calendar. Please try again.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      {/* Month Navigation */}
      <View className="px-6 py-4 flex-row justify-between items-center">
        <TouchableOpacity
          onPress={handlePrevMonth}
          className="p-2"
        >
          <Text className="text-lg text-blue-600">‹</Text>
        </TouchableOpacity>
        <Text className="text-xl font-semibold text-gray-900">
          {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        <TouchableOpacity
          onPress={handleNextMonth}
          className="p-2"
        >
          <Text className="text-lg text-blue-600">›</Text>
        </TouchableOpacity>
      </View>

      {/* Calendar Grid */}
      {isLoading ? (
        <View className="justify-center items-center py-12">
          <ActivityIndicator size="large" color="#0066cc" />
        </View>
      ) : (
        <>
          {/* Day headers */}
          <View className="flex-row px-6">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <View key={day} className="flex-1 py-2">
                <Text className="text-center text-xs font-semibold text-gray-600">
                  {day}
                </Text>
              </View>
            ))}
          </View>

          {/* Calendar days */}
          <View className="px-6 pb-4">
            {Array.from({ length: Math.ceil(calendarDays.length / 7) }).map(
              (_, weekIndex) => (
                <View key={weekIndex} className="flex-row mb-2">
                  {calendarDays.slice(weekIndex * 7, (weekIndex + 1) * 7).map(
                    (day, dayIndex) => {
                      if (day === null) {
                        return <View key={`empty-${dayIndex}`} className="flex-1" />;
                      }

                      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(
                        day
                      ).padStart(2, '0')}`;
                      const hasMemories = datedDays.has(dateStr);
                      const isSelected = selectedDate === dateStr;

                      return (
                        <TouchableOpacity
                          key={day}
                          onPress={() => handleDayPress(day)}
                          className={`flex-1 aspect-square rounded-lg border justify-center items-center mx-0.5 mb-1 ${
                            isSelected
                              ? 'bg-blue-600 border-blue-600'
                              : hasMemories
                              ? 'bg-blue-50 border-blue-300'
                              : 'bg-gray-50 border-gray-200'
                          }`}
                        >
                          <View className="justify-center items-center">
                            <Text
                              className={`text-sm font-medium ${
                                isSelected ? 'text-white' : 'text-gray-900'
                              }`}
                            >
                              {day}
                            </Text>
                            {hasMemories && !isSelected && (
                              <View className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1" />
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    }
                  )}
                </View>
              )
            )}
          </View>

          {/* Selected Day Memories */}
          {selectedDate && (
            <View className="border-t border-gray-200 px-6 py-4">
              <Text className="text-lg font-semibold text-gray-900 mb-4">
                {formatDateOnly(selectedDate)}
              </Text>

              {selectedDayMemories.length === 0 ? (
                <Text className="text-gray-600 text-center py-6">
                  No memories for this day
                </Text>
              ) : (
                <FlatList
                  scrollEnabled={false}
                  data={selectedDayMemories}
                  keyExtractor={(item) => item.memoryId}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      onPress={() => handleMemoryPress(item.memoryId)}
                      className="py-3 px-3 mb-3 bg-gray-50 rounded-lg border border-gray-200 flex-row justify-between items-center"
                    >
                      <View className="flex-1">
                        <Text
                          className="text-base font-medium text-gray-900"
                          numberOfLines={2}
                        >
                          {item.title}
                        </Text>
                        {item.type && (
                          <Text className="text-xs text-gray-600 mt-1">
                            {item.type}
                          </Text>
                        )}
                      </View>
                      <Text className="text-gray-400 ml-2">›</Text>
                    </TouchableOpacity>
                  )}
                />
              )}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
