import React, { useMemo } from 'react';

interface ContributionData {
  date: Date;
  count: number;
  type?: 'create' | 'update' | 'delete' | 'other';
}

interface ContributionsChartProps {
  data: ContributionData[];
  weekStartDay?: 'sunday' | 'monday';
  height?: number;
  squareSize?: number;
  gap?: number;
  onDateHover?: (date: Date, count: number) => void;
  onDateClick?: (date: Date) => void;
  selectedDate?: Date | null;
}

const getColorByIntensity = (count: number, max: number): string => {
  if (count === 0) return 'bg-slate-200 dark:bg-slate-700';
  const intensity = Math.min(count / max, 1);

  if (intensity < 0.25) return 'bg-emerald-200 dark:bg-emerald-800';
  if (intensity < 0.5) return 'bg-emerald-400 dark:bg-emerald-600';
  if (intensity < 0.75) return 'bg-emerald-600 dark:bg-emerald-500';
  return 'bg-emerald-700 dark:bg-emerald-400';
};

const getMonthLabel = (date: Date): string => {
  return date.toLocaleDateString('en-US', { month: 'short' });
};

export const ContributionsChart: React.FC<ContributionsChartProps> = ({
  data,
  weekStartDay = 'sunday',
  squareSize = 12,
  gap = 2,
  onDateClick,
  selectedDate,
}) => {
  const chartData = useMemo(() => {
    if (data.length === 0) return { weeks: [], maxCount: 0, monthLabels: new Map(), dates: [] };

    const maxCount = Math.max(...data.map((d) => d.count), 1);
    const dataMap = new Map(data.map((d) => [d.date.toDateString(), d.count]));

    const startDate = new Date(data[0].date);
    startDate.setDate(startDate.getDate() - startDate.getDay());
    if (weekStartDay === 'monday' && startDate.getDay() === 0) {
      startDate.setDate(startDate.getDate() + 1);
    }

    const endDate = new Date(data[data.length - 1].date);
    const weeks: (number | null)[][] = [];
    const dates: Date[][] = [];
    let currentWeek: (number | null)[] = [];
    let currentWeekDates: Date[] = [];

    const monthLabels = new Map<number, string>();

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      if (weeks.length === 0 || currentWeek.length === 7) {
        if (currentWeek.length > 0) {
          weeks.push(currentWeek);
          dates.push(currentWeekDates);
        }
        currentWeek = [];
        currentWeekDates = [];
      }

      const dateStr = new Date(d).toDateString();
      const count = dataMap.get(dateStr);

      if (currentWeek.length === 0) {
        const monthDate = new Date(d);
        const monthKey = weeks.length;
        if (!monthLabels.has(monthKey)) {
          monthLabels.set(monthKey, getMonthLabel(monthDate));
        }
      }

      currentWeek.push(count !== undefined ? count : 0);
      currentWeekDates.push(new Date(d));
    }

    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
      dates.push(currentWeekDates);
    }

    return { weeks, maxCount, monthLabels, dates };
  }, [data, weekStartDay]);

  const dayLabels = weekStartDay === 'sunday' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="w-full overflow-x-auto bg-surface border border-border rounded-lg p-4">
      <div className="inline-block">
        <div className="flex gap-2">
          {/* Day labels */}
          <div className="flex flex-col justify-start">
            <div style={{ height: '1.5rem' }}></div>
            {dayLabels.slice(0, 7).map((day, i) => (
              <div
                key={day}
                style={{
                  height: `${squareSize + gap}px`,
                  display: 'flex',
                  alignItems: 'center',
                }}
                className="text-xs text-text-muted pr-2"
              >
                {i % 2 === 0 ? day : ''}
              </div>
            ))}
          </div>

          {/* Weeks grid */}
          <div>
            {/* Month labels */}
            <div className="flex gap-1 pb-2 pl-1">
              {Array.from(chartData.monthLabels.entries()).map(([week, month]) => (
                <div
                  key={`month-${week}`}
                  style={{
                    width: week > 0 ? `${squareSize + gap}px` : '0',
                  }}
                  className="text-xs text-text-muted"
                >
                  {week > 0 && month}
                </div>
              ))}
            </div>

            {/* Grid */}
            <div className="flex gap-1">
              {chartData.weeks.map((week, weekIndex) => (
                <div key={`week-${weekIndex}`}>
                  {week.map((count, dayIndex) => {
                    const cellDate = chartData.dates[weekIndex]?.[dayIndex];
                    const isSelected = selectedDate && cellDate && cellDate.toDateString() === selectedDate.toDateString();
                    return (
                      <div
                        key={`day-${weekIndex}-${dayIndex}`}
                        onClick={() => cellDate && onDateClick?.(cellDate)}
                        style={{
                          width: `${squareSize}px`,
                          height: `${squareSize}px`,
                          marginBottom: `${gap}px`,
                        }}
                        className={`rounded-sm cursor-pointer transition-all hover:ring-2 hover:ring-offset-1 ${
                          isSelected ? 'ring-2 ring-accent ring-offset-1' : 'ring-emerald-600 hover:ring-emerald-600'
                        } ${getColorByIntensity(count || 0, chartData.maxCount)}`}
                        title={`${count || 0} contributions`}
                      ></div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-4 text-xs text-text-muted">
          <span>Less</span>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={`legend-${i}`}
                style={{
                  width: `${squareSize}px`,
                  height: `${squareSize}px`,
                }}
                className={`rounded-sm ${getColorByIntensity(
                  i === 0 ? 0 : (i / 4) * chartData.maxCount,
                  chartData.maxCount
                )}`}
              ></div>
            ))}
          </div>
          <span>More</span>
        </div>
      </div>
    </div>
  );
};
