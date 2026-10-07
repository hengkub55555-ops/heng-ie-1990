import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { ProductionLineName, ShiftName } from '../types/production';

interface ParsedRow {
  timeRange: string;
  line: ProductionLineName;
  onlineQty: number;
  offlineQty: number;
  shift: ShiftName;
}

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportRows: (rows: ParsedRow[]) => Promise<void>;
}

const SAMPLE_MES_PASTE = `2026-10-06 20:00\tProduction Line B\t102\t69
2026-10-06 21:00\tProduction Line B\t65\t103
2026-10-06 22:00\tProduction Line B\t103\t72
2026-10-06 23:00\tProduction Line B\t15\t15
2026-10-07 00:00\tProduction Line B\t127\t87
2026-10-07 01:00\tProduction Line B\t66\t68`;

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImportRows,
}) => {
  const [rawText, setRawText] = useState(SAMPLE_MES_PASTE);
  const [defaultLine, setDefaultLine] = useState<ProductionLineName>('Production Line B');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const parseInput = (text: string): ParsedRow[] => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const results: ParsedRow[] = [];

    for (const line of lines) {
      // Skip header lines if present
      if (line.toLowerCase().includes('time range') || line.toLowerCase().includes('online qty')) {
        continue;
      }

      const parts = line.split(/\t|,/).map((p) => p.trim());
      // Support both:
      // [No, Time range, Line, Online qty, Offline qty] (5 cols from MES copy)
      // or [Time range, Line, Online qty, Offline qty] (4 cols)
      // or [Time range, Online qty, Offline qty] (3 cols)
      let timeRange = '';
      let lineName: ProductionLineName = defaultLine;
      let onlineQty = 0;
      let offlineQty = 0;

      if (parts.length >= 5) {
        timeRange = parts[1];
        lineName = parts[2].includes('Line A') ? 'Production Line A' : 'Production Line B';
        onlineQty = Number(parts[3]);
        offlineQty = Number(parts[4]);
      } else if (parts.length === 4) {
        timeRange = parts[0];
        lineName = parts[1].includes('Line A') ? 'Production Line A' : 'Production Line B';
        onlineQty = Number(parts[2]);
        offlineQty = Number(parts[3]);
      } else if (parts.length === 3) {
        timeRange = parts[0];
        onlineQty = Number(parts[1]);
        offlineQty = Number(parts[2]);
      } else {
        continue;
      }

      if (!timeRange || Number.isNaN(onlineQty) || Number.isNaN(offlineQty)) {
        continue;
      }

      const hourNum = Number(timeRange.slice(11, 13));
      const shift: ShiftName =
        !Number.isNaN(hourNum) && (hourNum >= 20 || hourNum < 8)
          ? 'Night Shift'
          : 'Day Shift';

      results.push({
        timeRange: timeRange.slice(0, 16),
        line: lineName,
        onlineQty: Math.max(0, Math.min(100000, Math.round(onlineQty))),
        offlineQty: Math.max(0, Math.min(100000, Math.round(offlineQty))),
        shift,
      });
    }

    return results;
  };

  const previewRows = parseInput(rawText);

  const handleConfirmImport = async () => {
    if (previewRows.length === 0) {
      setErrorMsg('ไม่พบข้อมูลที่ถูกต้อง กรุณาตรวจสอบรูปแบบข้อความที่วาง');
      return;
    }
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      await onImportRows(previewRows);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการนำเข้าข้อมูล');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full p-6 shadow-lg">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              นำเข้าข้อมูลจากระบบ MES (Paste / CSV Import)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              คัดลอกตารางจากหน้า Hourly Production Report หรือวางข้อมูล CSV เพื่อบันทึกและวิเคราะห์ความผิดปกติทันที
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <label className="text-xs font-medium text-slate-700">
              Line เริ่มต้น (กรณีข้อความไม่ได้ระบุชื่อ Line):
            </label>
            <select
              value={defaultLine}
              onChange={(e) => setDefaultLine(e.target.value as ProductionLineName)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900"
            >
              <option value="Production Line A">Production Line A</option>
              <option value="Production Line B">Production Line B</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              วางข้อมูลตาราง (รูปแบบ: Time range | Line | Online qty | Offline qty)
            </label>
            <textarea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="w-full p-3 text-xs font-mono-tabular border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="2026-10-06 20:00&#9;Production Line B&#9;102&#9;69"
            />
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-md p-3">
            <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
              <span className="font-medium">ตัวอย่างข้อมูลที่ตรวจพบ ({previewRows.length} แถว)</span>
              <span className="font-mono-tabular">
                Total Online: {previewRows.reduce((acc, r) => acc + r.onlineQty, 0)} · Total Offline:{' '}
                {previewRows.reduce((acc, r) => acc + r.offlineQty, 0)}
              </span>
            </div>
            <div className="max-h-32 overflow-y-auto border-t border-slate-200 pt-2 space-y-1">
              {previewRows.map((row, idx) => (
                <div
                  key={`${row.timeRange}-${row.line}-${idx}`}
                  className="flex items-center justify-between text-xs font-mono-tabular text-slate-700"
                >
                  <span>
                    {idx + 1}. {row.timeRange} · {row.line}
                  </span>
                  <span>
                    Online: <strong>{row.onlineQty}</strong> / Offline: <strong>{row.offlineQty}</strong>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs text-red-600 font-medium">{errorMsg}</p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={isSubmitting || previewRows.length === 0}
            onClick={handleConfirmImport}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'กำลังบันทึก...' : `นำเข้าข้อมูล (${previewRows.length} รายการ)`}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
