"use client";

export interface TabInfo {
  dateStr: string;
  label: string;
  hasData: boolean;
  hasUnsaved: boolean;
  isToday: boolean;
  isAbsent: boolean;
}

interface Props {
  tabs: TabInfo[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

export function DayTabBar({ tabs, activeIndex, onSelect }: Props) {
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-slate-200 flex flex-shrink-0">
      {tabs.map((tab, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={tab.dateStr}
            type="button"
            onClick={() => onSelect(i)}
            className={`flex-1 relative py-3 text-sm font-medium transition ${
              isActive
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-slate-500 border-b-2 border-transparent"
            }`}
          >
            {tab.label}
            {tab.isAbsent && (
              <span className="absolute top-1.5 right-1/2 translate-x-3 w-1.5 h-1.5 rounded-full bg-red-400" />
            )}
            {!tab.isAbsent && tab.hasUnsaved && (
              <span className="absolute top-1.5 right-1/2 translate-x-3 w-1.5 h-1.5 rounded-full bg-orange-400" />
            )}
            {!tab.isAbsent && !tab.hasUnsaved && tab.isToday && (
              <span className="absolute top-1.5 right-1/2 translate-x-3 w-1.5 h-1.5 rounded-full bg-blue-500" />
            )}
            {!tab.isAbsent && !tab.hasUnsaved && !tab.isToday && tab.hasData && (
              <span className="absolute top-1.5 right-1/2 translate-x-3 w-1.5 h-1.5 rounded-full bg-slate-300" />
            )}
          </button>
        );
      })}
    </div>
  );
}
