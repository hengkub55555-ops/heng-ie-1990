export type ProductionLineName = 'Production Line A' | 'Production Line B';
export type ShiftName = 'Day Shift' | 'Night Shift';
export type LogHealthStatus = 'Normal' | 'Warning' | 'Anomaly';
export type AlertSeverity = 'Warning' | 'Critical';
export type AlertType =
  | 'UPH Drop'
  | 'Online-Offline Imbalance'
  | 'High Defect Rate'
  | 'Machine Downtime';
export type AlertStatus = 'Open' | 'Acknowledged' | 'Resolved';

// Validation constants synchronized verbatim with firebase-blueprint.json
export const VALIDATION_LIMITS = {
  ID_MAX_LEN: 128,
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  TIME_RANGE_MIN_LEN: 10,
  TIME_RANGE_MAX_LEN: 32,
  LINE_MAX_LEN: 32,
  SHIFT_MAX_LEN: 24,
  NOTE_MAX_LEN: 500,
  STATUS_MAX_LEN: 24,
  ALERT_TITLE_MAX_LEN: 160,
  ALERT_DESC_MAX_LEN: 500,
  ROOT_CAUSE_MAX_LEN: 300,
  MAX_QTY: 100000,
  MAX_DOWNTIME_MINS: 60,
};

export interface ProductionLogRecord {
  id: string;
  ownerId: string;
  timeRange: string; // e.g., "2026-10-06 20:00"
  line: ProductionLineName;
  onlineQty: number;
  offlineQty: number;
  targetOnlineQty: number;
  targetOfflineQty: number;
  ngQty: number;
  downtimeMinutes: number;
  shift: ShiftName;
  operatorNote: string;
  status: LogHealthStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProductionAlertRecord {
  id: string;
  ownerId: string;
  timeRange: string;
  line: ProductionLineName;
  severity: AlertSeverity;
  alertType: AlertType;
  title: string;
  description: string;
  status: AlertStatus;
  rootCause: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LineConfigRecord {
  id: string;
  ownerId: string;
  line: ProductionLineName;
  targetOnlineUph: number;
  targetOfflineUph: number;
  minOnlineThreshold: number;
  minOfflineThreshold: number;
  maxImbalanceGap: number;
  updatedAt?: unknown;
}

export const DEFAULT_LINE_CONFIGS: Record<ProductionLineName, Omit<LineConfigRecord, 'id' | 'ownerId'>> = {
  'Production Line A': {
    line: 'Production Line A',
    targetOnlineUph: 105,
    targetOfflineUph: 85,
    minOnlineThreshold: 65,
    minOfflineThreshold: 55,
    maxImbalanceGap: 35,
  },
  'Production Line B': {
    line: 'Production Line B',
    targetOnlineUph: 100,
    targetOfflineUph: 80,
    minOnlineThreshold: 60,
    minOfflineThreshold: 50,
    maxImbalanceGap: 35,
  },
};

export function evaluateLogHealth(
  onlineQty: number,
  offlineQty: number,
  ngQty: number,
  downtimeMinutes: number,
  config: Omit<LineConfigRecord, 'id' | 'ownerId'>
): {
  status: LogHealthStatus;
  detectedAnomaly?: {
    severity: AlertSeverity;
    alertType: AlertType;
    title: string;
    description: string;
  };
} {
  const imbalance = Math.abs(onlineQty - offlineQty);

  if (onlineQty < config.minOnlineThreshold || offlineQty < config.minOfflineThreshold) {
    const isCritical =
      onlineQty < config.minOnlineThreshold * 0.5 ||
      offlineQty < config.minOfflineThreshold * 0.5;
    return {
      status: 'Anomaly',
      detectedAnomaly: {
        severity: isCritical ? 'Critical' : 'Warning',
        alertType: 'UPH Drop',
        title: `ยอดผลิตตกต่ำกว่าเกณฑ์ขั้นต่ำ (${onlineQty} Online / ${offlineQty} Offline)`,
        description: `ตรวจพบยอดผลิตต่ำกว่าเกณฑ์ (เกณฑ์ขั้นต่ำ Online ≥ ${config.minOnlineThreshold}, Offline ≥ ${config.minOfflineThreshold} UPH) มีเวลาหยุดเครื่อง ${downtimeMinutes} นาที`,
      },
    };
  }

  if (downtimeMinutes >= 15) {
    return {
      status: 'Anomaly',
      detectedAnomaly: {
        severity: downtimeMinutes >= 25 ? 'Critical' : 'Warning',
        alertType: 'Machine Downtime',
        title: `เครื่องจักรหยุดทำงานเกินกำหนด (${downtimeMinutes} นาที)`,
        description: `เกิด Unplanned Downtime ${downtimeMinutes} นาที ส่งผลให้ประสิทธิภาพรายชั่วโมงลดลง`,
      },
    };
  }

  if (ngQty >= 10) {
    return {
      status: 'Warning',
      detectedAnomaly: {
        severity: ngQty >= 20 ? 'Critical' : 'Warning',
        alertType: 'High Defect Rate',
        title: `พบชิ้นงานเสีย (NG) สูงผิดปกติ (${ngQty} ชิ้น)`,
        description: `จำนวน NG ${ngQty} ชิ้นในชั่วโมงเดียว เกินค่าควบคุมคุณภาพที่กำหนด`,
      },
    };
  }

  if (imbalance > config.maxImbalanceGap) {
    return {
      status: 'Warning',
      detectedAnomaly: {
        severity: 'Warning',
        alertType: 'Online-Offline Imbalance',
        title: `ยอด Online และ Offline ไม่สมดุล (ต่างกัน ${imbalance} ชิ้น)`,
        description: `Online = ${onlineQty} ชิ้น, Offline = ${offlineQty} ชิ้น (ส่วนต่าง ${imbalance} ชิ้น เกินเกณฑ์สมดุล ${config.maxImbalanceGap} ชิ้น บ่งชี้ WIP สะสม)`,
      },
    };
  }

  return { status: 'Normal' };
}

// Initial dataset grounded directly in the user's MES screenshot (2026-10-06 20:00 to 2026-10-07 01:00)
export const INITIAL_SHIFT_LOGS: Omit<ProductionLogRecord, 'ownerId'>[] = [
  // Production Line B (Exact figures from uploaded MES Hourly Production Report)
  {
    id: 'seed_line_b_2000',
    timeRange: '2026-10-06 20:00',
    line: 'Production Line B',
    onlineQty: 102,
    offlineQty: 69,
    targetOnlineQty: 100,
    targetOfflineQty: 80,
    ngQty: 2,
    downtimeMinutes: 0,
    shift: 'Night Shift',
    operatorNote: 'เดินเครื่องปกติ เริ่มกะดึก 20:00 น.',
    status: 'Normal',
  },
  {
    id: 'seed_line_b_2100',
    timeRange: '2026-10-06 21:00',
    line: 'Production Line B',
    onlineQty: 65,
    offlineQty: 103,
    targetOnlineQty: 100,
    targetOfflineQty: 80,
    ngQty: 3,
    downtimeMinutes: 8,
    shift: 'Night Shift',
    operatorNote: 'ระบายงานค้างจากสถานี SFG Offline ช่วงต้นชั่วโมง (ส่วนต่าง Online/Offline 38 ชิ้น)',
    status: 'Warning',
  },
  {
    id: 'seed_line_b_2200',
    timeRange: '2026-10-06 22:00',
    line: 'Production Line B',
    onlineQty: 103,
    offlineQty: 72,
    targetOnlineQty: 100,
    targetOfflineQty: 80,
    ngQty: 1,
    downtimeMinutes: 0,
    shift: 'Night Shift',
    operatorNote: 'อัตราการผลิต Online ทะลุเป้าหมาย 103%',
    status: 'Normal',
  },
  {
    id: 'seed_line_b_2300',
    timeRange: '2026-10-06 23:00',
    line: 'Production Line B',
    onlineQty: 15,
    offlineQty: 15,
    targetOnlineQty: 100,
    targetOfflineQty: 80,
    ngQty: 4,
    downtimeMinutes: 42,
    shift: 'Night Shift',
    operatorNote: 'เกิดเหตุ Feeder ติดขัดและพักเบรกผลัดเปลี่ยนชุดหัวจับชิ้นงาน (UPH Drop เหลือ 15/15)',
    status: 'Anomaly',
  },
  {
    id: 'seed_line_b_0000',
    timeRange: '2026-10-07 00:00',
    line: 'Production Line B',
    onlineQty: 127,
    offlineQty: 87,
    targetOnlineQty: 100,
    targetOfflineQty: 80,
    ngQty: 2,
    downtimeMinutes: 0,
    shift: 'Night Shift',
    operatorNote: 'เร่งสปีดชดเชยยอดหลังซ่อมบำรุงเสร็จสิ้น (Peak UPH 127 Online)',
    status: 'Warning',
  },
  {
    id: 'seed_line_b_0100',
    timeRange: '2026-10-07 01:00',
    line: 'Production Line B',
    onlineQty: 66,
    offlineQty: 68,
    targetOnlineQty: 100,
    targetOfflineQty: 80,
    ngQty: 1,
    downtimeMinutes: 10,
    shift: 'Night Shift',
    operatorNote: 'ปรับตั้งค่าความเร็วเข้าสู่โหมดสมดุล Online/Offline',
    status: 'Normal',
  },

  // Production Line A (Parallel Shift Comparison Data for 2026-10-06 20:00 to 2026-10-07 01:00)
  {
    id: 'seed_line_a_2000',
    timeRange: '2026-10-06 20:00',
    line: 'Production Line A',
    onlineQty: 108,
    offlineQty: 84,
    targetOnlineQty: 105,
    targetOfflineQty: 85,
    ngQty: 1,
    downtimeMinutes: 0,
    shift: 'Night Shift',
    operatorNote: 'เดินเครื่องปกติตามแผนการผลิต Line A',
    status: 'Normal',
  },
  {
    id: 'seed_line_a_2100',
    timeRange: '2026-10-06 21:00',
    line: 'Production Line A',
    onlineQty: 104,
    offlineQty: 88,
    targetOnlineQty: 105,
    targetOfflineQty: 85,
    ngQty: 2,
    downtimeMinutes: 0,
    shift: 'Night Shift',
    operatorNote: 'อัตราการผลิตคงที่ สมดุลทั้ง Online และ Offline',
    status: 'Normal',
  },
  {
    id: 'seed_line_a_2200',
    timeRange: '2026-10-06 22:00',
    line: 'Production Line A',
    onlineQty: 98,
    offlineQty: 82,
    targetOnlineQty: 105,
    targetOfflineQty: 85,
    ngQty: 2,
    downtimeMinutes: 4,
    shift: 'Night Shift',
    operatorNote: 'เติมวัตถุดิบ Lot ใหม่ ใช้เวลา 4 นาที',
    status: 'Normal',
  },
  {
    id: 'seed_line_a_2300',
    timeRange: '2026-10-06 23:00',
    line: 'Production Line A',
    onlineQty: 74,
    offlineQty: 64,
    targetOnlineQty: 105,
    targetOfflineQty: 85,
    ngQty: 1,
    downtimeMinutes: 12,
    shift: 'Night Shift',
    operatorNote: 'สลับผลัดพักเบรกย่อย 12 นาที ยอดผลิตยังอยู่ในเกณฑ์ควบคุม',
    status: 'Normal',
  },
  {
    id: 'seed_line_a_0000',
    timeRange: '2026-10-07 00:00',
    line: 'Production Line A',
    onlineQty: 112,
    offlineQty: 91,
    targetOnlineQty: 105,
    targetOfflineQty: 85,
    ngQty: 1,
    downtimeMinutes: 0,
    shift: 'Night Shift',
    operatorNote: 'เดินเครื่องเต็มกำลัง 106% ของเป้าหมาย',
    status: 'Normal',
  },
  {
    id: 'seed_line_a_0100',
    timeRange: '2026-10-07 01:00',
    line: 'Production Line A',
    onlineQty: 105,
    offlineQty: 86,
    targetOnlineQty: 105,
    targetOfflineQty: 85,
    ngQty: 2,
    downtimeMinutes: 0,
    shift: 'Night Shift',
    operatorNote: 'รักษามาตรฐาน UPH ตามเป้าหมายกะดึก',
    status: 'Normal',
  },
];

export const INITIAL_ALERTS: Omit<ProductionAlertRecord, 'ownerId'>[] = [
  {
    id: 'seed_alert_2300_b',
    timeRange: '2026-10-06 23:00',
    line: 'Production Line B',
    severity: 'Critical',
    alertType: 'UPH Drop',
    title: 'ยอดผลิต Line B ตกต่ำวิกฤต (Online 15 / Offline 15 UPH)',
    description:
      'ช่วงเวลา 2026-10-06 23:00 ยอด Online ลดลงเหลือ 15 ชิ้น (-85% จากเป้าหมาย 100 UPH) และ Offline เหลือ 15 ชิ้น เนื่องจาก Feeder ติดขัดและเปลี่ยนชุดหัวจับชิ้นงาน 42 นาที',
    status: 'Open',
    rootCause: 'รอวิศวกรยืนยันการปรับตั้งค่า Tension ของชุด Feeder สถานีที่ 2',
  },
  {
    id: 'seed_alert_2100_b',
    timeRange: '2026-10-06 21:00',
    line: 'Production Line B',
    severity: 'Warning',
    alertType: 'Online-Offline Imbalance',
    title: 'ความไม่สมดุลระหว่าง Online (65) และ Offline (103) เกินเกณฑ์',
    description:
      'ช่วงเวลา 2026-10-06 21:00 ของ Production Line B มีส่วนต่างระหว่าง Online และ Offline เท่ากับ 38 ชิ้น (เกินเกณฑ์ 35 ชิ้น) เกิดจากการระบายงาน WIP สะสมที่สถานี SFG Offline',
    status: 'Acknowledged',
    rootCause: 'หัวหน้ากะรับทราบ: เคลียร์ Buffer งาน SFG Offline จากกะก่อนหน้า',
  },
  {
    id: 'seed_alert_0000_b',
    timeRange: '2026-10-07 00:00',
    line: 'Production Line B',
    severity: 'Warning',
    alertType: 'Online-Offline Imbalance',
    title: 'ยอด Online พุ่งสูงกว่า Offline 40 ชิ้น (127 vs 87)',
    description:
      'ช่วงเวลา 2026-10-07 00:00 สถานี Online เร่งสปีดได้ 127 ชิ้น ขณะที่สถานี Offline ทำได้ 87 ชิ้น มีงานรอเข้าสถานี Offline สะสมเพิ่ม 40 ชิ้น',
    status: 'Open',
    rootCause: '',
  },
];
