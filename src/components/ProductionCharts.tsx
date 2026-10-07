import React, { useState } from 'react';
import { ProductionLogRecord } from '../types/production';

interface HourlyComparisonChartProps {
  logs: ProductionLogRecord[];
  metricMode: 'combined' | 'online' | 'offline';
  onMetricModeChange: (mode: 'combined' | 'online' | 'offline') => void;
  targetLineA: number;
  targetLineB: number;
}

export const HourlyComparisonChart: React.FC<HourlyComparisonChartProps> = ({
  logs,
  metricMode,
  onMetricModeChange,
  targetLineA,
  targetLineB,
}) => {
  const [hoveredTime, setHoveredTime] = useState<string | null>(null);

  // Group logs by timeRange sorted chronologically
  const timeSlots = Array.from(new Set(logs.map((l) => l.timeRange))).sort();

  const chartData = timeSlots.map((slot) => {
    const lineA = logs.find((l) => l.timeRange === slot && l.line === 'Production Line A');
    const lineB = logs.find((l) => l.timeRange === slot && l.line === 'Production Line B');

    const getVal = (rec?: ProductionLogRecord) => {
      if (!rec) return 0;
      if (metricMode === 'online') return rec.onlineQty;
      if (metricMode === 'offline') return rec.offlineQty;
      return rec.onlineQty + rec.offlineQty;
    };

    return {
      timeRange: slot,
      shortTime: slot.slice(11, 16) || slot,
      datePart: slot.slice(5, 10),
      valA: getVal(lineA),
      valB: getVal(lineB),
      rawA: lineA,
      rawB: lineB,
    };
  });

  const maxDataVal = Math.max(
    targetLineA,
    targetLineB,
    ...chartData.flatMap((d) => [d.valA, d.valB]),
    150
  );
  const yMax = Math.ceil(maxDataVal / 40) * 40;

  const svgWidth = 820;
  const svgHeight = 290;
  const padLeft = 52;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 46;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * yMax));

  const getY = (v: number) => padTop + plotH - (v / yMax) * plotH;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            กราฟเปรียบเทียบประสิทธิภาพรายชั่วโมง (Line A vs Line B)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            แสดงยอดการผลิตรายชั่วโมงเทียบกับค่าเป้าหมาย (Target UPH) และจุดที่เกิดความผิดปกติ
          </p>
        </div>

        {/* Interactive Segmented Control */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          <button
            type="button"
            onClick={() => onMetricModeChange('online')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              metricMode === 'online'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Online Qty
          </button>
          <button
            type="button"
            onClick={() => onMetricModeChange('offline')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              metricMode === 'offline'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Offline Qty (SFG)
          </button>
          <button
            type="button"
            onClick={() => onMetricModeChange('combined')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              metricMode === 'combined'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            รวม Online + Offline
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 pb-2 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-5">
          <span className="inline-flex items-center gap-2">
            <span className="w-3 h-3 rounded-xs bg-blue-600 inline-block" />
            <span>Production Line A</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-3 h-3 rounded-xs bg-teal-600 inline-block" />
            <span>Production Line B</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-4 border-t-2 border-dashed border-amber-600 inline-block" />
            <span className="font-mono-tabular">
              Target Line B ({targetLineB} UPH)
            </span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" />
            <span>จุดที่เกิดความผิดปกติ (Anomaly)</span>
          </span>
        </div>
        <div className="text-xs text-slate-500 font-mono-tabular">
          ชี้ที่แท่งกราฟเพื่อดูรายละเอียดรายชั่วโมง
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-sm">
          ไม่พบข้อมูลในช่วงเวลาที่เลือก
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-auto min-w-[600px] select-none"
          >
            {/* Horizontal grid lines */}
            {yTicks.map((tick) => {
              const y = getY(tick);
              return (
                <g key={tick}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={svgWidth - padRight}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeDasharray={tick === 0 ? undefined : '3 3'}
                    strokeWidth="1"
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-slate-500 text-[11px] font-mono-tabular"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}

            {/* Target Reference Lines */}
            {targetLineB <= yMax && (
              <g>
                <line
                  x1={padLeft}
                  y1={getY(targetLineB)}
                  x2={svgWidth - padRight}
                  y2={getY(targetLineB)}
                  stroke="#d97706"
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                />
              </g>
            )}

            {/* Bars per time slot */}
            {chartData.map((d, idx) => {
              const slotWidth = plotW / chartData.length;
              const centerX = padLeft + idx * slotWidth + slotWidth / 2;
              const barW = Math.min(28, Math.max(12, slotWidth * 0.28));
              const gap = 4;

              const xA = centerX - barW - gap / 2;
              const xB = centerX + gap / 2;

              const yA = getY(d.valA);
              const hA = Math.max(2, padTop + plotH - yA);

              const yB = getY(d.valB);
              const hB = Math.max(2, padTop + plotH - yB);

              const isAnomalyA = d.rawA?.status === 'Anomaly';
              const isAnomalyB = d.rawB?.status === 'Anomaly';
              const isHovered = hoveredTime === d.timeRange;

              return (
                <g
                  key={d.timeRange}
                  onMouseEnter={() => setHoveredTime(d.timeRange)}
                  onMouseLeave={() => setHoveredTime(null)}
                  className="cursor-pointer"
                >
                  {/* Hover column highlight */}
                  <rect
                    x={padLeft + idx * slotWidth + 2}
                    y={padTop}
                    width={slotWidth - 4}
                    height={plotH}
                    fill={isHovered ? '#f1f5f9' : 'transparent'}
                    rx="4"
                  />

                  {/* Line A Bar */}
                  {d.rawA && (
                    <g>
                      <rect
                        x={xA}
                        y={yA}
                        width={barW}
                        height={hA}
                        rx="3"
                        fill={isAnomalyA ? '#dc2626' : '#2563eb'}
                      />
                      <text
                        x={xA + barW / 2}
                        y={yA - 6}
                        textAnchor="middle"
                        className="fill-slate-700 text-[10px] font-mono-tabular font-medium"
                      >
                        {d.valA}
                      </text>
                    </g>
                  )}

                  {/* Line B Bar */}
                  {d.rawB && (
                    <g>
                      <rect
                        x={xB}
                        y={yB}
                        width={barW}
                        height={hB}
                        rx="3"
                        fill={isAnomalyB ? '#dc2626' : '#0d9488'}
                      />
                      <text
                        x={xB + barW / 2}
                        y={yB - 6}
                        textAnchor="middle"
                        className={`text-[10px] font-mono-tabular font-semibold ${
                          isAnomalyB ? 'fill-red-600' : 'fill-slate-800'
                        }`}
                      >
                        {d.valB}
                      </text>
                      {isAnomalyB && (
                        <circle
                          cx={xB + barW / 2}
                          cy={yB - 18}
                          r="4"
                          fill="#dc2626"
                        />
                      )}
                    </g>
                  )}

                  {/* X-axis label */}
                  <text
                    x={centerX}
                    y={padTop + plotH + 18}
                    textAnchor="middle"
                    className="fill-slate-700 text-[11px] font-mono-tabular font-medium"
                  >
                    {d.shortTime}
                  </text>
                  <text
                    x={centerX}
                    y={padTop + plotH + 32}
                    textAnchor="middle"
                    className="fill-slate-400 text-[10px] font-mono-tabular"
                  >
                    {d.datePart}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Contextual Details Strip for Hovered Slot */}
          {hoveredTime && (() => {
            const slot = chartData.find((c) => c.timeRange === hoveredTime);
            if (!slot) return null;
            return (
              <div className="mt-2 px-4 py-2.5 bg-slate-900 text-white rounded-md flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="font-mono-tabular font-semibold">
                  ช่วงเวลา: {slot.timeRange}
                </div>
                <div className="flex flex-wrap items-center gap-6 font-mono-tabular">
                  <span>
                    Line A: Online <strong>{slot.rawA?.onlineQty ?? '-'}</strong> · Offline{' '}
                    <strong>{slot.rawA?.offlineQty ?? '-'}</strong>
                  </span>
                  <span>
                    Line B: Online <strong>{slot.rawB?.onlineQty ?? '-'}</strong> · Offline{' '}
                    <strong>{slot.rawB?.offlineQty ?? '-'}</strong>
                    {slot.rawB?.status === 'Anomaly' && (
                      <span className="ml-2 text-red-400 font-semibold">
                        (ผิดปกติ: {slot.rawB.operatorNote})
                      </span>
                    )}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

interface OnlineOfflineBalanceChartProps {
  logs: ProductionLogRecord[];
  selectedLine: 'ALL' | 'Production Line A' | 'Production Line B';
}

export const OnlineOfflineBalanceChart: React.FC<OnlineOfflineBalanceChartProps> = ({
  logs,
  selectedLine,
}) => {
  const filtered =
    selectedLine === 'ALL'
      ? logs.filter((l) => l.line === 'Production Line B')
      : logs.filter((l) => l.line === selectedLine);

  const sorted = [...filtered].sort((a, b) => a.timeRange.localeCompare(b.timeRange));

  const maxVal = Math.max(
    ...sorted.flatMap((l) => [l.onlineQty, l.offlineQty]),
    140
  );
  const yMax = Math.ceil(maxVal / 30) * 30;

  const svgWidth = 520;
  const svgHeight = 250;
  const padLeft = 44;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 42;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const getX = (i: number) =>
    sorted.length <= 1
      ? padLeft + plotW / 2
      : padLeft + (i / (sorted.length - 1)) * plotW;
  const getY = (v: number) => padTop + plotH - (v / yMax) * plotH;

  const onlinePoints = sorted.map((d, i) => `${getX(i)},${getY(d.onlineQty)}`).join(' ');
  const offlinePoints = sorted.map((d, i) => `${getX(i)},${getY(d.offlineQty)}`).join(' ');

  const displayLineName =
    selectedLine === 'ALL' ? 'Production Line B (อ้างอิงตามรายงานหลัก)' : selectedLine;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              แนวโน้มสมดุล Online vs Offline (SFG)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {displayLineName} · ตรวจจับคอขวดและงานสะสมระหว่างสถานี
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5 pt-3 pb-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-2">
            <span className="w-3 h-0.5 bg-blue-600 inline-block" />
            <span>Online Qty</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-3 h-0.5 bg-amber-600 inline-block" />
            <span>Offline Qty (SFG)</span>
          </span>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-slate-500">
          ไม่มีข้อมูลสำหรับแสดงกราฟแนวโน้ม
        </div>
      ) : (
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto select-none">
          {[0, 0.5, 1].map((t) => {
            const val = Math.round(t * yMax);
            const y = getY(val);
            return (
              <g key={val}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={svgWidth - padRight}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray="3 3"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-500 text-[10px] font-mono-tabular"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Lines */}
          {sorted.length > 1 && (
            <>
              <polyline
                fill="none"
                stroke="#2563eb"
                strokeWidth="2.5"
                points={onlinePoints}
              />
              <polyline
                fill="none"
                stroke="#d97706"
                strokeWidth="2.5"
                points={offlinePoints}
              />
            </>
          )}

          {/* Data nodes */}
          {sorted.map((d, i) => {
            const cx = getX(i);
            const cyOn = getY(d.onlineQty);
            const cyOff = getY(d.offlineQty);
            return (
              <g key={d.id}>
                <circle
                  cx={cx}
                  cy={cyOn}
                  r={d.status === 'Anomaly' ? 5 : 3.5}
                  fill={d.status === 'Anomaly' ? '#dc2626' : '#2563eb'}
                />
                <circle
                  cx={cx}
                  cy={cyOff}
                  r={d.status === 'Anomaly' ? 5 : 3.5}
                  fill={d.status === 'Anomaly' ? '#dc2626' : '#d97706'}
                />
                <text
                  x={cx}
                  y={padTop + plotH + 18}
                  textAnchor="middle"
                  className="fill-slate-600 text-[10px] font-mono-tabular"
                >
                  {d.timeRange.slice(11, 16)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};
