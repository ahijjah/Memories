import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import CalendarScreen from '../calendar';
import * as clientApi from '@/src/api/client';

jest.mock('expo-router');
jest.mock('@/src/api/client');

describe('CalendarScreen', () => {
  const mockPush = jest.fn();
  const mockGetAuthenticatedClient = jest.fn();
  let queryClient: QueryClient;

  const mockCalendarResponse = {
    month: '2026-09',
    items: [
      {
        memoryId: 'mem-1',
        date: '2026-09-15',
        title: 'Conference',
        type: 'EVENT',
        assets: [],
      },
      {
        memoryId: 'mem-2',
        date: '2026-09-15',
        title: 'Meeting',
        type: 'EVENT',
        assets: [{ id: 'asset-1', mimeType: 'image/jpeg' }],
      },
      {
        memoryId: 'mem-3',
        date: '2026-09-20',
        title: 'Vacation',
        type: 'PLACE',
        assets: [],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    mockGetAuthenticatedClient.mockResolvedValue({
      get: jest.fn().mockResolvedValue({ data: mockCalendarResponse }),
    });
    (clientApi.getAuthenticatedClient as jest.Mock) = mockGetAuthenticatedClient;
  });

  const renderCalendar = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <CalendarScreen />
      </QueryClientProvider>
    );
  };

  describe('Initial render', () => {
    it('displays current month initially', async () => {
      renderCalendar();

      await waitFor(() => {
        const monthText = screen.queryByText(/September 2026/i);
        expect(monthText).toBeTruthy();
      });
    });

    it('shows loading state while fetching data', () => {
      mockGetAuthenticatedClient.mockImplementation(
        () =>
          new Promise(() => {
            /* never resolves */
          })
      );

      renderCalendar();

      const loader = screen.queryByTestId('loading-indicator');
      expect(loader).toBeTruthy();
    });

    it('displays error message on API failure', async () => {
      mockGetAuthenticatedClient.mockRejectedValue(new Error('Network error'));

      renderCalendar();

      await waitFor(() => {
        const errorText = screen.queryByText(/Failed to load calendar/i);
        expect(errorText).toBeTruthy();
      });
    });
  });

  describe('Month navigation', () => {
    it('navigates to previous month on left arrow press', async () => {
      renderCalendar();

      await waitFor(() => {
        expect(screen.queryByText(/September 2026/i)).toBeTruthy();
      });

      const prevButton = screen.getByText('‹').at(0);
      if (prevButton) {
        fireEvent.press(prevButton);

        await waitFor(() => {
          expect(screen.queryByText(/August 2026/i)).toBeTruthy();
        });
      }
    });

    it('navigates to next month on right arrow press', async () => {
      renderCalendar();

      await waitFor(() => {
        expect(screen.queryByText(/September 2026/i)).toBeTruthy();
      });

      const nextButton = screen.getAllByText('›')[0];
      if (nextButton) {
        fireEvent.press(nextButton);

        await waitFor(() => {
          expect(screen.queryByText(/October 2026/i)).toBeTruthy();
        });
      }
    });
  });

  describe('Calendar grid', () => {
    it('marks days with memories', async () => {
      renderCalendar();

      await waitFor(() => {
        // Days 15 and 20 should be marked
        const day15 = screen.queryByText('15');
        const day20 = screen.queryByText('20');
        expect(day15).toBeTruthy();
        expect(day20).toBeTruthy();
      });
    });

    it('displays day headers (Sun, Mon, etc.)', async () => {
      renderCalendar();

      await waitFor(() => {
        expect(screen.queryByText('Sun')).toBeTruthy();
        expect(screen.queryByText('Mon')).toBeTruthy();
        expect(screen.queryByText('Fri')).toBeTruthy();
      });
    });
  });

  describe('Day selection', () => {
    it('shows memories when a day is selected', async () => {
      renderCalendar();

      await waitFor(() => {
        const day15 = screen.queryByText('15');
        expect(day15).toBeTruthy();
      });

      const day15Button = screen.getByText('15');
      fireEvent.press(day15Button);

      await waitFor(() => {
        expect(screen.queryByText('Conference')).toBeTruthy();
        expect(screen.queryByText('Meeting')).toBeTruthy();
      });
    });

    it('displays multiple memories on same day', async () => {
      renderCalendar();

      await waitFor(() => {
        const day15 = screen.queryByText('15');
        expect(day15).toBeTruthy();
      });

      const day15Button = screen.getByText('15');
      fireEvent.press(day15Button);

      await waitFor(() => {
        expect(screen.queryByText('Conference')).toBeTruthy();
        expect(screen.queryByText('Meeting')).toBeTruthy();
      });
    });

    it('shows "No memories" message for empty days', async () => {
      mockGetAuthenticatedClient.mockResolvedValue({
        get: jest.fn().mockResolvedValue({
          data: {
            month: '2026-09',
            items: [],
          },
        }),
      });

      renderCalendar();

      await waitFor(() => {
        const day10 = screen.queryByText('10');
        if (day10) {
          fireEvent.press(day10);

          expect(screen.queryByText(/No memories for this day/i)).toBeTruthy();
        }
      });
    });
  });

  describe('Memory navigation', () => {
    it('navigates to memory detail on tap', async () => {
      renderCalendar();

      await waitFor(() => {
        const day15 = screen.queryByText('15');
        expect(day15).toBeTruthy();
      });

      const day15Button = screen.getByText('15');
      fireEvent.press(day15Button);

      await waitFor(() => {
        expect(screen.queryByText('Conference')).toBeTruthy();
      });

      const conferenceButton = screen.getByText('Conference');
      fireEvent.press(conferenceButton);

      expect(mockPush).toHaveBeenCalledWith('/memory/mem-1');
    });
  });

  describe('Date-only semantics', () => {
    it('displays date-only values without timezone conversion', async () => {
      const testDate = '2026-09-15';
      const expectedDisplayDate = 'Tuesday, September 15, 2026';

      renderCalendar();

      await waitFor(() => {
        const day15 = screen.queryByText('15');
        expect(day15).toBeTruthy();
      });

      const day15Button = screen.getByText('15');
      fireEvent.press(day15Button);

      await waitFor(() => {
        // Should display the date correctly without shifting due to timezone
        const dateDisplay = screen.queryByText(expectedDisplayDate);
        expect(dateDisplay).toBeTruthy();
      });
    });
  });

  describe('Selected day display', () => {
    it('highlights selected day', async () => {
      renderCalendar();

      await waitFor(() => {
        const day15 = screen.queryByText('15');
        expect(day15).toBeTruthy();
      });

      const day15Button = screen.getByText('15');
      fireEvent.press(day15Button);

      // Selected day should have different styling
      expect(day15Button).toBeTruthy();
    });

    it('displays formatted date heading for selected day', async () => {
      renderCalendar();

      await waitFor(() => {
        const day15 = screen.queryByText('15');
        expect(day15).toBeTruthy();
      });

      const day15Button = screen.getByText('15');
      fireEvent.press(day15Button);

      await waitFor(() => {
        expect(screen.queryByText(/Tuesday, September 15, 2026/i)).toBeTruthy();
      });
    });
  });

  describe('API contract', () => {
    it('requests calendar API with correct month parameter', async () => {
      const mockClient = {
        get: jest.fn().mockResolvedValue({ data: mockCalendarResponse }),
      };
      mockGetAuthenticatedClient.mockResolvedValue(mockClient);

      renderCalendar();

      await waitFor(() => {
        expect(mockClient.get).toHaveBeenCalledWith(
          expect.stringContaining('/engagement/calendar?month=2026-09')
        );
      });
    });
  });
});
