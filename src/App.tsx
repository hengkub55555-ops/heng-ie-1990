import React, { useState, useEffect, useMemo } from 'react';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  Search,
  Download,
  Plus,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Edit3,
  Upload,
  LogIn,
  LogOut,
  Sliders,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  OperationType,
  handleFirestoreError,
} from './firebase';
import {
  ProductionLineName,
  ShiftName,
  ProductionLogRecord,
  ProductionAlertRecord,
  LineConfigRecord,
  DEFAULT_LINE_CONFIGS,
  INITIAL_SHIFT_LOGS,
  INITIAL_ALERTS,
  VALIDATION_LIMITS,
  evaluateLogHealth,
  AlertSeverity,
  AlertType,
} from './types/production';
import {
  HourlyComparisonChart,
  OnlineOfflineBalanceChart,
} from './components/ProductionCharts';
import { ImportModal } from './components/ImportModal';

type NavTab = 'overview' | 'hourly_report' | 'comparison' | 'alerts' | 'settings';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>('overview');

  // Data states (initialized with real shift data from the user's MES report for immediate use)
  const [logs, setLogs] = useState<ProductionLogRecord[]>(() =>
    INITIAL_SHIFT_LOGS.map((item) => ({ ...item, ownerId: 'local_preview' }))
  );
  const [alerts, setAlerts] = useState<ProductionAlertRecord[]>(() =>
    INITIAL_ALERTS.map((item) => ({ ...item, ownerId: 'local_preview' }))
  );
  const [lineConfigs, setLineConfigs] = useState<
    Record<ProductionLineName, Omit<LineConfigRecord, 'id' | 'ownerId'>>
  >(DEFAULT_LINE_CONFIGS);

  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [hasSeededCloud, setHasSeededCloud] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // Filter states for Hourly Production Report (matching the uploaded MES screenshot)
  const [startTimeFilter, setStartTimeFilter] = useState('2026-10-06 20:00');
  const [endTimeFilter, setEndTimeFilter] = useState('2026-10-07 02:00');
  const [lineFilter, setLineFilter] = useState<'ALL' | ProductionLineName>('Production Line B');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({
    seed_line_b_2300: true,
  });

  // Chart metric mode
  const [chartMetricMode, setChartMetricMode] = useState<'combined' | 'online' | 'offline'>(
    'online'
  );

  // Modals & Entry Forms
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<ProductionLogRecord | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);

  // Log Entry Form State
  const [formTimeRange, setFormTimeRange] = useState('2026-10-07 02:00');
  const [formLine, setFormLine] = useState<ProductionLineName>('Production Line B');
  const [formOnlineQty, setFormOnlineQty] = useState<number>(98);
  const [formOfflineQty, setFormOfflineQty] = useState<number>(82);
  const [formNgQty, setFormNgQty] = useState<number>(1);
  const [formDowntime, setFormDowntime] = useState<number>(0);
  const [formShift, setFormShift] = useState<ShiftName>('Night Shift');
  const [formNote, setFormNote] = useState<string>('');

  // Manual Alert Form State
  const [alertTimeRange, setAlertTimeRange] = useState('2026-10-07 01:00');
  const [alertLine, setAlertLine] = useState<ProductionLineName>('Production Line B');
  const [alertSeverity, setAlertSeverity] = useState<AlertSeverity>('Warning');
  const [alertType, setAlertType] = useState<AlertType>('UPH Drop');
  const [alertTitle, setAlertTitle] = useState('');
  const [alertDesc, setAlertDesc] = useState('');

  // Alert filter & root cause draft
  const [alertStatusFilter, setAlertStatusFilter] = useState<'ALL' | 'Open' | 'Acknowledged' | 'Resolved'>('ALL');
  const [rootCauseDrafts, setRootCauseDrafts] = useState<Record<string, string>>({});

  // Settings Form State
  const [configDraft, setConfigDraft] = useState(DEFAULT_LINE_CONFIGS);

  // 1. Auth Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 2. Real-time Firestore Synchronization when signed in
  useEffect(() => {
    if (!authReady || !user) {
      setIsLoadingCloud(false);
      return;
    }

    setIsLoadingCloud(true);
    const uid = user.uid;

    const logsQuery = query(collection(db, 'production_logs'), where('ownerId', '==', uid));
    const alertsQuery = query(collection(db, 'production_alerts'), where('ownerId', '==', uid));
    const configsQuery = query(collection(db, 'line_configs'), where('ownerId', '==', uid));

    const unsubLogs = onSnapshot(
      logsQuery,
      async (snapshot) => {
        if (snapshot.empty && !hasSeededCloud) {
          setHasSeededCloud(true);
          await seedInitialDataToFirestore(uid);
          return;
        }
        const loadedLogs: ProductionLogRecord[] = snapshot.docs.map((d) => ({
          ...(d.data() as Omit<ProductionLogRecord, 'id'>),
          id: d.id,
        }));
        loadedLogs.sort((a, b) => a.timeRange.localeCompare(b.timeRange));
        setLogs(loadedLogs);
        setIsLoadingCloud(false);
      },
      (error) => {
        setIsLoadingCloud(false);
        handleFirestoreError(error, OperationType.LIST, 'production_logs');
      }
    );

    const unsubAlerts = onSnapshot(
      alertsQuery,
      (snapshot) => {
        const loadedAlerts: ProductionAlertRecord[] = snapshot.docs.map((d) => ({
          ...(d.data() as Omit<ProductionAlertRecord, 'id'>),
          id: d.id,
        }));
        loadedAlerts.sort((a, b) => b.timeRange.localeCompare(a.timeRange));
        setAlerts(loadedAlerts);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'production_alerts');
      }
    );

    const unsubConfigs = onSnapshot(
      configsQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const nextConfigs = { ...DEFAULT_LINE_CONFIGS };
          snapshot.docs.forEach((d) => {
            const data = d.data() as LineConfigRecord;
            if (data.line === 'Production Line A' || data.line === 'Production Line B') {
              nextConfigs[data.line] = {
                line: data.line,
                targetOnlineUph: data.targetOnlineUph,
                targetOfflineUph: data.targetOfflineUph,
                minOnlineThreshold: data.minOnlineThreshold,
                minOfflineThreshold: data.minOfflineThreshold,
                maxImbalanceGap: data.maxImbalanceGap,
              };
            }
          });
          setLineConfigs(nextConfigs);
          setConfigDraft(nextConfigs);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'line_configs');
      }
    );

    return () => {
      unsubLogs();
      unsubAlerts();
      unsubConfigs();
    };
  }, [authReady, user, hasSeededCloud]);

  const showTransientBanner = (msg: string) => {
    setBannerMessage(msg);
    setTimeout(() => {
      setBannerMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  const seedInitialDataToFirestore = async (uid: string) => {
    try {
      const batch = writeBatch(db);

      for (const item of INITIAL_SHIFT_LOGS) {
        const docId = `${uid}_${item.id}`.slice(0, 120).replace(/[^a-zA-Z0-9_\-]/g, '_');
        const ref = doc(db, 'production_logs', docId);
        batch.set(ref, {
          ownerId: uid,
          timeRange: item.timeRange.slice(0, VALIDATION_LIMITS.TIME_RANGE_MAX_LEN),
          line: item.line,
          onlineQty: item.onlineQty,
          offlineQty: item.offlineQty,
          targetOnlineQty: item.targetOnlineQty,
          targetOfflineQty: item.targetOfflineQty,
          ngQty: item.ngQty,
          downtimeMinutes: item.downtimeMinutes,
          shift: item.shift,
          operatorNote: item.operatorNote.slice(0, VALIDATION_LIMITS.NOTE_MAX_LEN),
          status: item.status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      for (const alertItem of INITIAL_ALERTS) {
        const docId = `${uid}_${alertItem.id}`.slice(0, 120).replace(/[^a-zA-Z0-9_\-]/g, '_');
        const ref = doc(db, 'production_alerts', docId);
        batch.set(ref, {
          ownerId: uid,
          timeRange: alertItem.timeRange.slice(0, VALIDATION_LIMITS.TIME_RANGE_MAX_LEN),
          line: alertItem.line,
          severity: alertItem.severity,
          alertType: alertItem.alertType,
          title: alertItem.title.slice(0, VALIDATION_LIMITS.ALERT_TITLE_MAX_LEN),
          description: alertItem.description.slice(0, VALIDATION_LIMITS.ALERT_DESC_MAX_LEN),
          status: alertItem.status,
          rootCause: alertItem.rootCause.slice(0, VALIDATION_LIMITS.ROOT_CAUSE_MAX_LEN),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      for (const lineKey of ['Production Line A', 'Production Line B'] as ProductionLineName[]) {
        const cfg = DEFAULT_LINE_CONFIGS[lineKey];
        const slug = lineKey === 'Production Line A' ? 'line_a' : 'line_b';
        const docId = `${uid}_cfg_${slug}`.slice(0, 120).replace(/[^a-zA-Z0-9_\-]/g, '_');
        const ref = doc(db, 'line_configs', docId);
        batch.set(ref, {
          ownerId: uid,
          line: cfg.line,
          targetOnlineUph: cfg.targetOnlineUph,
          targetOfflineUph: cfg.targetOfflineUph,
          minOnlineThreshold: cfg.minOnlineThreshold,
          minOfflineThreshold: cfg.minOfflineThreshold,
          maxImbalanceGap: cfg.maxImbalanceGap,
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      showTransientBanner('ซิงค์ข้อมูลกะการผลิตเริ่มต้นเข้าสู่ Cloud Firestore สำเร็จ');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'production_logs');
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      showTransientBanner('เข้าสู่ระบบสำเร็จ ข้อมูลทั้งหมดจะถูกบันทึกลง Cloud Firestore แบบ Real-time');
    } catch (err) {
      console.error('Sign-in error:', err);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    showTransientBanner('ออกจากระบบแล้ว ตอนนี้แสดงผลในโหมด Local Preview');
  };

  // Filtered logs for the Hourly Production Report & Charts
  const filteredLogs = useMemo(() => {
    return logs
      .filter((item) => {
        if (lineFilter !== 'ALL' && item.line !== lineFilter) return false;
        if (startTimeFilter && item.timeRange < startTimeFilter) return false;
        if (endTimeFilter && item.timeRange > endTimeFilter) return false;
        if (searchQuery.trim() !== '') {
          const q = searchQuery.toLowerCase();
          const matchTime = item.timeRange.toLowerCase().includes(q);
          const matchLine = item.line.toLowerCase().includes(q);
          const matchNote = item.operatorNote.toLowerCase().includes(q);
          const matchStatus = item.status.toLowerCase().includes(q);
          if (!matchTime && !matchLine && !matchNote && !matchStatus) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp = a.timeRange.localeCompare(b.timeRange);
        if (cmp !== 0) return cmp;
        return a.line.localeCompare(b.line);
      });
  }, [logs, lineFilter, startTimeFilter, endTimeFilter, searchQuery]);

  // Daily Summary Metrics separated by Line A and Line B
  const summaryStats = useMemo(() => {
    const computeForLine = (lineName: ProductionLineName) => {
      const lineRecords = logs.filter(
        (l) =>
          l.line === lineName &&
          (!startTimeFilter || l.timeRange >= startTimeFilter) &&
          (!endTimeFilter || l.timeRange <= endTimeFilter)
      );
      const hoursCount = lineRecords.length;
      const totalOnline = lineRecords.reduce((s, r) => s + r.onlineQty, 0);
      const totalOffline = lineRecords.reduce((s, r) => s + r.offlineQty, 0);
      const totalTargetOnline = lineRecords.reduce((s, r) => s + r.targetOnlineQty, 0);
      const totalTargetOffline = lineRecords.reduce((s, r) => s + r.targetOfflineQty, 0);
      const totalNg = lineRecords.reduce((s, r) => s + r.ngQty, 0);
      const totalDowntime = lineRecords.reduce((s, r) => s + r.downtimeMinutes, 0);
      const avgOnlineUph = hoursCount > 0 ? Math.round(totalOnline / hoursCount) : 0;
      const avgOfflineUph = hoursCount > 0 ? Math.round(totalOffline / hoursCount) : 0;
      const achievementPct =
        totalTargetOnline + totalTargetOffline > 0
          ? Math.round(
              ((totalOnline + totalOffline) / (totalTargetOnline + totalTargetOffline)) * 100
            )
          : 0;
      const anomalyCount = lineRecords.filter((r) => r.status === 'Anomaly').length;

      return {
        hoursCount,
        totalOnline,
        totalOffline,
        combinedQty: totalOnline + totalOffline,
        avgOnlineUph,
        avgOfflineUph,
        achievementPct,
        totalNg,
        totalDowntime,
        anomalyCount,
      };
    };

    const lineA = computeForLine('Production Line A');
    const lineB = computeForLine('Production Line B');
    const openAlertsCount = alerts.filter((a) => a.status !== 'Resolved').length;
    const criticalAlertsCount = alerts.filter(
      (a) => a.status !== 'Resolved' && a.severity === 'Critical'
    ).length;

    return {
      lineA,
      lineB,
      totalOnlineAll: lineA.totalOnline + lineB.totalOnline,
      totalOfflineAll: lineA.totalOffline + lineB.totalOffline,
      combinedAll: lineA.combinedQty + lineB.combinedQty,
      openAlertsCount,
      criticalAlertsCount,
    };
  }, [logs, alerts, startTimeFilter, endTimeFilter]);

  // Open modal for new or edit log
  const openAddLogModal = (defaultLine?: ProductionLineName) => {
    setEditingLog(null);
    setFormTimeRange('2026-10-07 02:00');
    setFormLine(defaultLine || (lineFilter === 'ALL' ? 'Production Line B' : lineFilter));
    const cfg = lineConfigs[defaultLine || 'Production Line B'];
    setFormOnlineQty(cfg.targetOnlineUph);
    setFormOfflineQty(cfg.targetOfflineUph);
    setFormNgQty(0);
    setFormDowntime(0);
    setFormShift('Night Shift');
    setFormNote('เดินเครื่องปกติ');
    setIsLogModalOpen(true);
  };

  const openEditLogModal = (record: ProductionLogRecord) => {
    setEditingLog(record);
    setFormTimeRange(record.timeRange);
    setFormLine(record.line);
    setFormOnlineQty(record.onlineQty);
    setFormOfflineQty(record.offlineQty);
    setFormNgQty(record.ngQty);
    setFormDowntime(record.downtimeMinutes);
    setFormShift(record.shift);
    setFormNote(record.operatorNote);
    setIsLogModalOpen(true);
  };

  // Save (Create or Update) Production Log + Auto Anomaly Detection
  const handleSaveProductionLog = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanTimeRange = formTimeRange.trim().slice(0, VALIDATION_LIMITS.TIME_RANGE_MAX_LEN);
    if (cleanTimeRange.length < VALIDATION_LIMITS.TIME_RANGE_MIN_LEN) return;

    const safeOnline = Math.max(0, Math.min(VALIDATION_LIMITS.MAX_QTY, Math.round(Number(formOnlineQty) || 0)));
    const safeOffline = Math.max(0, Math.min(VALIDATION_LIMITS.MAX_QTY, Math.round(Number(formOfflineQty) || 0)));
    const safeNg = Math.max(0, Math.min(VALIDATION_LIMITS.MAX_QTY, Math.round(Number(formNgQty) || 0)));
    const safeDowntime = Math.max(0, Math.min(VALIDATION_LIMITS.MAX_DOWNTIME_MINS, Math.round(Number(formDowntime) || 0)));
    const cleanNote = (formNote.trim() || 'บันทึกข้อมูลรายชั่วโมง').slice(0, VALIDATION_LIMITS.NOTE_MAX_LEN);

    const cfg = lineConfigs[formLine];
    const health = evaluateLogHealth(safeOnline, safeOffline, safeNg, safeDowntime, cfg);

    if (user) {
      const uid = user.uid;
      const docId = editingLog
        ? editingLog.id
        : `${uid}_log_${Date.now()}`.replace(/[^a-zA-Z0-9_\-]/g, '_');

      const logPayload = {
        ownerId: uid,
        timeRange: cleanTimeRange,
        line: formLine,
        onlineQty: safeOnline,
        offlineQty: safeOffline,
        targetOnlineQty: cfg.targetOnlineUph,
        targetOfflineQty: cfg.targetOfflineUph,
        ngQty: safeNg,
        downtimeMinutes: safeDowntime,
        shift: formShift,
        operatorNote: cleanNote,
        status: health.status,
        updatedAt: serverTimestamp(),
      };

      try {
        if (editingLog) {
          await updateDoc(doc(db, 'production_logs', docId), logPayload);
        } else {
          await setDoc(doc(db, 'production_logs', docId), {
            ...logPayload,
            createdAt: serverTimestamp(),
          });
        }

        // Automatically create an anomaly alert if an anomaly/warning was triggered
        if (health.detectedAnomaly) {
          const alertId = `${uid}_alert_${Date.now()}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
          await setDoc(doc(db, 'production_alerts', alertId), {
            ownerId: uid,
            timeRange: cleanTimeRange,
            line: formLine,
            severity: health.detectedAnomaly.severity,
            alertType: health.detectedAnomaly.alertType,
            title: health.detectedAnomaly.title.slice(0, VALIDATION_LIMITS.ALERT_TITLE_MAX_LEN),
            description: health.detectedAnomaly.description.slice(0, VALIDATION_LIMITS.ALERT_DESC_MAX_LEN),
            status: 'Open',
            rootCause: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          showTransientBanner(
            `บันทึกข้อมูลและแจ้งเตือนความผิดปกติอัตโนมัติ: ${health.detectedAnomaly.title}`
          );
        } else {
          showTransientBanner('บันทึกข้อมูลการผลิตรายชั่วโมงลงฐานข้อมูลสำเร็จ');
        }
      } catch (error) {
        handleFirestoreError(
          error,
          editingLog ? OperationType.UPDATE : OperationType.CREATE,
          `production_logs/${docId}`
        );
      }
    } else {
      // Local preview state update
      const newRecord: ProductionLogRecord = {
        id: editingLog ? editingLog.id : `local_log_${Date.now()}`,
        ownerId: 'local_preview',
        timeRange: cleanTimeRange,
        line: formLine,
        onlineQty: safeOnline,
        offlineQty: safeOffline,
        targetOnlineQty: cfg.targetOnlineUph,
        targetOfflineQty: cfg.targetOfflineUph,
        ngQty: safeNg,
        downtimeMinutes: safeDowntime,
        shift: formShift,
        operatorNote: cleanNote,
        status: health.status,
      };

      setLogs((prev) => {
        const filtered = prev.filter((item) => item.id !== newRecord.id);
        return [...filtered, newRecord].sort((a, b) => a.timeRange.localeCompare(b.timeRange));
      });

      if (health.detectedAnomaly) {
        const newAlert: ProductionAlertRecord = {
          id: `local_alert_${Date.now()}`,
          ownerId: 'local_preview',
          timeRange: cleanTimeRange,
          line: formLine,
          severity: health.detectedAnomaly.severity,
          alertType: health.detectedAnomaly.alertType,
          title: health.detectedAnomaly.title,
          description: health.detectedAnomaly.description,
          status: 'Open',
          rootCause: '',
        };
        setAlerts((prev) => [newAlert, ...prev]);
        showTransientBanner(
          `บันทึกข้อมูลและสร้างการแจ้งเตือนอัตโนมัติ: ${health.detectedAnomaly.title}`
        );
      } else {
        showTransientBanner('บันทึกข้อมูลรายชั่วโมงเรียบร้อยแล้ว');
      }
    }

    // Ensure time filter covers newly added record
    if (cleanTimeRange > endTimeFilter) {
      setEndTimeFilter(cleanTimeRange);
    }
    if (cleanTimeRange < startTimeFilter) {
      setStartTimeFilter(cleanTimeRange);
    }

    setIsLogModalOpen(false);
  };

  const handleDeleteLog = async (record: ProductionLogRecord) => {
    if (user) {
      try {
        await deleteDoc(doc(db, 'production_logs', record.id));
        showTransientBanner(`ลบรายการช่วงเวลา ${record.timeRange} (${record.line}) แล้ว`);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `production_logs/${record.id}`);
      }
    } else {
      setLogs((prev) => prev.filter((l) => l.id !== record.id));
      showTransientBanner(`ลบรายการช่วงเวลา ${record.timeRange} (${record.line}) แล้ว`);
    }
  };

  // Batch Import from MES Clipboard / CSV
  const handleBatchImport = async (
    rows: {
      timeRange: string;
      line: ProductionLineName;
      onlineQty: number;
      offlineQty: number;
      shift: ShiftName;
    }[]
  ) => {
    if (user) {
      const uid = user.uid;
      const batch = writeBatch(db);
      let anomalyCount = 0;

      rows.forEach((r, idx) => {
        const cfg = lineConfigs[r.line];
        const health = evaluateLogHealth(r.onlineQty, r.offlineQty, 0, 0, cfg);
        const docId = `${uid}_imp_${Date.now()}_${idx}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
        batch.set(doc(db, 'production_logs', docId), {
          ownerId: uid,
          timeRange: r.timeRange.slice(0, VALIDATION_LIMITS.TIME_RANGE_MAX_LEN),
          line: r.line,
          onlineQty: r.onlineQty,
          offlineQty: r.offlineQty,
          targetOnlineQty: cfg.targetOnlineUph,
          targetOfflineQty: cfg.targetOfflineUph,
          ngQty: 0,
          downtimeMinutes: 0,
          shift: r.shift,
          operatorNote: 'นำเข้าข้อมูลจากรายงาน Hourly Production Report',
          status: health.status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (health.detectedAnomaly) {
          anomalyCount++;
          const alertId = `${uid}_impalert_${Date.now()}_${idx}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
          batch.set(doc(db, 'production_alerts', alertId), {
            ownerId: uid,
            timeRange: r.timeRange.slice(0, VALIDATION_LIMITS.TIME_RANGE_MAX_LEN),
            line: r.line,
            severity: health.detectedAnomaly.severity,
            alertType: health.detectedAnomaly.alertType,
            title: health.detectedAnomaly.title.slice(0, VALIDATION_LIMITS.ALERT_TITLE_MAX_LEN),
            description: health.detectedAnomaly.description.slice(
              0,
              VALIDATION_LIMITS.ALERT_DESC_MAX_LEN
            ),
            status: 'Open',
            rootCause: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });

      try {
        await batch.commit();
        showTransientBanner(
          `นำเข้าข้อมูล ${rows.length} รายการสำเร็จ (ตรวจพบความผิดปกติ ${anomalyCount} รายการ)`
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'production_logs');
      }
    } else {
      const importedLogs: ProductionLogRecord[] = [];
      const importedAlerts: ProductionAlertRecord[] = [];

      rows.forEach((r, idx) => {
        const cfg = lineConfigs[r.line];
        const health = evaluateLogHealth(r.onlineQty, r.offlineQty, 0, 0, cfg);
        importedLogs.push({
          id: `local_imp_${Date.now()}_${idx}`,
          ownerId: 'local_preview',
          timeRange: r.timeRange,
          line: r.line,
          onlineQty: r.onlineQty,
          offlineQty: r.offlineQty,
          targetOnlineQty: cfg.targetOnlineUph,
          targetOfflineQty: cfg.targetOfflineUph,
          ngQty: 0,
          downtimeMinutes: 0,
          shift: r.shift,
          operatorNote: 'นำเข้าข้อมูลจากรายงาน Hourly Production Report',
          status: health.status,
        });

        if (health.detectedAnomaly) {
          importedAlerts.push({
            id: `local_impalert_${Date.now()}_${idx}`,
            ownerId: 'local_preview',
            timeRange: r.timeRange,
            line: r.line,
            severity: health.detectedAnomaly.severity,
            alertType: health.detectedAnomaly.alertType,
            title: health.detectedAnomaly.title,
            description: health.detectedAnomaly.description,
            status: 'Open',
            rootCause: '',
          });
        }
      });

      setLogs((prev) => [...prev, ...importedLogs]);
      if (importedAlerts.length > 0) {
        setAlerts((prev) => [...importedAlerts, ...prev]);
      }
      showTransientBanner(
        `นำเข้าข้อมูล ${rows.length} รายการสำเร็จ (ตรวจพบความผิดปกติ ${importedAlerts.length} รายการ)`
      );
    }
  };

  // Export filtered Hourly Production Report as CSV
  const handleExportCsv = () => {
    const headers = [
      'No.',
      'Time range',
      'Line',
      'Online qty',
      'Offline qty',
      'Target Online',
      'Target Offline',
      'NG qty',
      'Downtime (mins)',
      'Status',
      'Operator Note',
    ];
    const rows = filteredLogs.map((r, i) => [
      i + 1,
      r.timeRange,
      r.line,
      r.onlineQty,
      r.offlineQty,
      r.targetOnlineQty,
      r.targetOfflineQty,
      r.ngQty,
      r.downtimeMinutes,
      r.status,
      `"${r.operatorNote.replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Hourly_Production_Report_${lineFilter.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Alert Status Transitions (Acknowledge / Resolve)
  const handleUpdateAlertStatus = async (
    alertRec: ProductionAlertRecord,
    nextStatus: 'Acknowledged' | 'Resolved'
  ) => {
    if (alertRec.status === 'Resolved') return;
    const draftNote =
      rootCauseDrafts[alertRec.id] !== undefined
        ? rootCauseDrafts[alertRec.id]
        : alertRec.rootCause;
    const cleanRootCause = (
      draftNote.trim() ||
      (nextStatus === 'Resolved'
        ? 'ดำเนินการแก้ไขและตรวจสอบเครื่องจักรเข้าสู่ภาวะปกติแล้ว'
        : 'หัวหน้ากะรับทราบและกำลังตรวจสอบหน้างาน')
    ).slice(0, VALIDATION_LIMITS.ROOT_CAUSE_MAX_LEN);

    if (user) {
      try {
        await updateDoc(doc(db, 'production_alerts', alertRec.id), {
          status: nextStatus,
          rootCause: cleanRootCause,
          updatedAt: serverTimestamp(),
        });
        showTransientBanner(
          nextStatus === 'Resolved'
            ? 'ปิดงานแก้ไขความผิดปกติ (Resolved) เรียบร้อยแล้ว'
            : 'รับทราบการแจ้งเตือน (Acknowledged) แล้ว'
        );
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.UPDATE,
          `production_alerts/${alertRec.id}`
        );
      }
    } else {
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertRec.id
            ? { ...a, status: nextStatus, rootCause: cleanRootCause }
            : a
        )
      );
      showTransientBanner(
        nextStatus === 'Resolved'
          ? 'ปิดงานแก้ไขความผิดปกติ (Resolved) เรียบร้อยแล้ว'
          : 'รับทราบการแจ้งเตือน (Acknowledged) แล้ว'
      );
    }
  };

  const handleCreateManualAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = alertTitle.trim().slice(0, VALIDATION_LIMITS.ALERT_TITLE_MAX_LEN);
    const cleanDesc = alertDesc.trim().slice(0, VALIDATION_LIMITS.ALERT_DESC_MAX_LEN);
    if (!cleanTitle || !cleanDesc) return;

    if (user) {
      const uid = user.uid;
      const alertId = `${uid}_man_alert_${Date.now()}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
      try {
        await setDoc(doc(db, 'production_alerts', alertId), {
          ownerId: uid,
          timeRange: alertTimeRange.slice(0, VALIDATION_LIMITS.TIME_RANGE_MAX_LEN),
          line: alertLine,
          severity: alertSeverity,
          alertType,
          title: cleanTitle,
          description: cleanDesc,
          status: 'Open',
          rootCause: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        showTransientBanner('สร้างรายการแจ้งเตือนความผิดปกติสำเร็จ');
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `production_alerts/${alertId}`);
      }
    } else {
      const newAlert: ProductionAlertRecord = {
        id: `local_man_alert_${Date.now()}`,
        ownerId: 'local_preview',
        timeRange: alertTimeRange,
        line: alertLine,
        severity: alertSeverity,
        alertType,
        title: cleanTitle,
        description: cleanDesc,
        status: 'Open',
        rootCause: '',
      };
      setAlerts((prev) => [newAlert, ...prev]);
      showTransientBanner('สร้างรายการแจ้งเตือนความผิดปกติสำเร็จ');
    }

    setAlertTitle('');
    setAlertDesc('');
    setIsAlertModalOpen(false);
  };

  // Save Line Thresholds & Targets
  const handleSaveLineConfigs = async (e: React.FormEvent) => {
    e.preventDefault();
    setLineConfigs(configDraft);

    if (user) {
      const uid = user.uid;
      try {
        for (const lineKey of ['Production Line A', 'Production Line B'] as ProductionLineName[]) {
          const cfg = configDraft[lineKey];
          const slug = lineKey === 'Production Line A' ? 'line_a' : 'line_b';
          const docId = `${uid}_cfg_${slug}`.slice(0, 120).replace(/[^a-zA-Z0-9_\-]/g, '_');
          await setDoc(doc(db, 'line_configs', docId), {
            ownerId: uid,
            line: cfg.line,
            targetOnlineUph: Math.max(1, Math.min(100000, Number(cfg.targetOnlineUph) || 100)),
            targetOfflineUph: Math.max(1, Math.min(100000, Number(cfg.targetOfflineUph) || 80)),
            minOnlineThreshold: Math.max(0, Math.min(100000, Number(cfg.minOnlineThreshold) || 60)),
            minOfflineThreshold: Math.max(0, Math.min(100000, Number(cfg.minOfflineThreshold) || 50)),
            maxImbalanceGap: Math.max(0, Math.min(100000, Number(cfg.maxImbalanceGap) || 35)),
            updatedAt: serverTimestamp(),
          });
        }
        showTransientBanner('บันทึกค่าเป้าหมาย UPH และเกณฑ์การแจ้งเตือนของ Line A และ Line B สำเร็จ');
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'line_configs');
      }
    } else {
      showTransientBanner('อัปเดตค่าเป้าหมาย UPH และเกณฑ์แจ้งเตือนเรียบร้อยแล้ว');
    }
  };

  // Totals for the currently filtered table (matching the MES screenshot footer)
  const tableFooterTotals = useMemo(() => {
    const rowQty = filteredLogs.length;
    const totalOnlineQty = filteredLogs.reduce((acc, r) => acc + r.onlineQty, 0);
    const totalOfflineQty = filteredLogs.reduce((acc, r) => acc + r.offlineQty, 0);
    const totalNgQty = filteredLogs.reduce((acc, r) => acc + r.ngQty, 0);
    return {
      rowQty,
      totalOnlineQty,
      totalOfflineQty,
      combinedQty: totalOnlineQty + totalOfflineQty,
      totalNgQty,
    };
  }, [filteredLogs]);

  // Grouped comparison rows by hour for Tab 3 (Line A vs Line B)
  const comparisonHours = useMemo(() => {
    const hours = Array.from(new Set(logs.map((l) => l.timeRange))).sort();
    return hours.map((timeRange) => {
      const recA = logs.find((l) => l.timeRange === timeRange && l.line === 'Production Line A');
      const recB = logs.find((l) => l.timeRange === timeRange && l.line === 'Production Line B');
      const totalA = (recA?.onlineQty ?? 0) + (recA?.offlineQty ?? 0);
      const totalB = (recB?.onlineQty ?? 0) + (recB?.offlineQty ?? 0);
      return {
        timeRange,
        recA,
        recB,
        totalA,
        totalB,
        diffAB: totalA - totalB,
      };
    });
  }, [logs]);

  const toggleExpandRow = (id: string) => {
    setExpandedRowIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: Zone 1 (Single wordmark) — Zone 2 (5 nav links) — Zone 3 (2 primary actions) */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-4">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('overview');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap"
        >
          MES UPH Control
        </a>

        {/* Zone 2: 5 clean text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('overview');
            }}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'overview'
                ? 'text-blue-600 border-b-2 border-blue-600 font-semibold'
                : 'hover:text-slate-900'
            }`}
          >
            Dashboard สรุปรายวัน
          </a>
          <a
            href="#hourly-report"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('hourly_report');
            }}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'hourly_report'
                ? 'text-blue-600 border-b-2 border-blue-600 font-semibold'
                : 'hover:text-slate-900'
            }`}
          >
            Hourly Production Report
          </a>
          <a
            href="#comparison"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('comparison');
            }}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'comparison'
                ? 'text-blue-600 border-b-2 border-blue-600 font-semibold'
                : 'hover:text-slate-900'
            }`}
          >
            เปรียบเทียบ Line A / B
          </a>
          <a
            href="#alerts"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('alerts');
            }}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'alerts'
                ? 'text-blue-600 border-b-2 border-blue-600 font-semibold'
                : 'hover:text-slate-900'
            }`}
          >
            แจ้งเตือนความผิดปกติ ({summaryStats.openAlertsCount})
          </a>
          <a
            href="#settings"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('settings');
            }}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'settings'
                ? 'text-blue-600 border-b-2 border-blue-600 font-semibold'
                : 'hover:text-slate-900'
            }`}
          >
            ตั้งค่าเกณฑ์ UPH
          </a>
        </nav>

        {/* Zone 3: 2 primary actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => openAddLogModal()}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            + บันทึกยอดรายชั่วโมง
          </button>

          {user ? (
            <button
              type="button"
              onClick={handleSignOut}
              title={`เข้าสู่ระบบในชื่อ ${user.email || user.displayName}`}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              ออกจากระบบ
            </button>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="px-3.5 py-2 text-xs font-medium text-slate-900 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              ซิงค์ฐานข้อมูล Cloud
            </button>
          )}
        </div>
      </header>

      {/* Mobile Navigation Bar */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
        {(
          [
            ['overview', 'ภาพรวม'],
            ['hourly_report', 'Hourly Report'],
            ['comparison', 'เทียบ Line A/B'],
            ['alerts', `แจ้งเตือน (${summaryStats.openAlertsCount})`],
            ['settings', 'ตั้งค่า UPH'],
          ] as [NavTab, string][]
        ).map(([tabKey, label]) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setActiveTab(tabKey)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              activeTab === tabKey
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Transient Feedback Banner */}
      {bannerMessage && (
        <div className="bg-slate-900 text-white px-6 py-2.5 text-xs flex items-center justify-between">
          <span>{bannerMessage}</span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Cloud Persistence Status Bar + Active Critical Anomaly Notification */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 rounded-lg p-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-900">
                กะการผลิตปัจจุบัน: Night Shift (2026-10-06 20:00 ถึง 2026-10-07 02:00)
              </span>
              <span aria-hidden="true">·</span>
              <span>
                สถานะฐานข้อมูล:{' '}
                {user
                  ? `เชื่อมต่อ Cloud Firestore แล้ว (${user.email})`
                  : 'โหมดพร้อมใช้งานทันที (เข้าสู่ระบบด้วย Google เพื่อสำรองข้อมูลถาวรบน Cloud)'}
              </span>
            </div>
            {summaryStats.openAlertsCount > 0 && (
              <div className="flex items-center gap-2 text-xs text-red-600 font-medium pt-0.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  พบความผิดปกติในกระบวนการผลิตที่ยังไม่ปิดงาน {summaryStats.openAlertsCount} รายการ
                  (วิกฤต {summaryStats.criticalAlertsCount} รายการ — เช่น ช่วง 23:00 น. Line B ยอด
                  Online/Offline ตกเหลือ 15 ชิ้น)
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('alerts')}
                  className="underline font-semibold hover:text-red-800 ml-1 whitespace-nowrap cursor-pointer"
                >
                  ตรวจสอบและระบุสาเหตุ →
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>วางข้อมูลจาก MES / นำเข้า CSV</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* ===================================================================
            TAB 1: OVERVIEW (ภาพรวมการผลิต Real-time & สรุปยอดรายวัน แยก Line A, B)
           =================================================================== */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Side-by-Side Line A vs Line B Daily Summary Panels */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Production Line A Summary Card */}
              <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div>
                      <div className="text-xs text-slate-500">สายการผลิตที่ 1</div>
                      <h2 className="text-lg font-bold text-slate-900">Production Line A</h2>
                    </div>
                    <div className="text-right font-mono-tabular">
                      <div className="text-xs text-slate-500">ประสิทธิภาพเทียบเป้า</div>
                      <div
                        className={`text-base font-bold ${
                          summaryStats.lineA.achievementPct >= 95
                            ? 'text-emerald-700'
                            : summaryStats.lineA.achievementPct >= 80
                            ? 'text-amber-600'
                            : 'text-red-600'
                        }`}
                      >
                        {summaryStats.lineA.achievementPct}% ของเป้าหมาย
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-4 border-b border-slate-100">
                    <div>
                      <div className="text-xs text-slate-500">Total Online Qty</div>
                      <div className="text-2xl font-bold text-slate-900 font-mono-tabular mt-0.5">
                        {summaryStats.lineA.totalOnline.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                        เฉลี่ย {summaryStats.lineA.avgOnlineUph} UPH (เป้า{' '}
                        {lineConfigs['Production Line A'].targetOnlineUph})
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Total Offline Qty (SFG)</div>
                      <div className="text-2xl font-bold text-slate-900 font-mono-tabular mt-0.5">
                        {summaryStats.lineA.totalOffline.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                        เฉลี่ย {summaryStats.lineA.avgOfflineUph} UPH (เป้า{' '}
                        {lineConfigs['Production Line A'].targetOfflineUph})
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 flex flex-wrap items-center justify-between text-xs text-slate-600 font-mono-tabular gap-2">
                    <span>จำนวนชั่วโมง: {summaryStats.lineA.hoursCount} ชม.</span>
                    <span>·</span>
                    <span>งานเสีย (NG): {summaryStats.lineA.totalNg} ชิ้น</span>
                    <span>·</span>
                    <span>Downtime: {summaryStats.lineA.totalDowntime} นาที</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setLineFilter('Production Line A');
                      setActiveTab('hourly_report');
                    }}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    ดูตารางรายงาน Line A →
                  </button>
                  <button
                    type="button"
                    onClick={() => openAddLogModal('Production Line A')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer"
                  >
                    + บันทึก Line A
                  </button>
                </div>
              </div>

              {/* Production Line B Summary Card (Exact match with user's screenshot: Online 478, Offline 414) */}
              <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div>
                      <div className="text-xs text-slate-500">สายการผลิตที่ 2 (อ้างอิงรายงานหลัก)</div>
                      <h2 className="text-lg font-bold text-slate-900">Production Line B</h2>
                    </div>
                    <div className="text-right font-mono-tabular">
                      <div className="text-xs text-slate-500">ประสิทธิภาพเทียบเป้า</div>
                      <div
                        className={`text-base font-bold ${
                          summaryStats.lineB.achievementPct >= 95
                            ? 'text-emerald-700'
                            : summaryStats.lineB.achievementPct >= 80
                            ? 'text-amber-600'
                            : 'text-red-600'
                        }`}
                      >
                        {summaryStats.lineB.achievementPct}% ของเป้าหมาย
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-4 border-b border-slate-100">
                    <div>
                      <div className="text-xs text-slate-500">Total Online Qty</div>
                      <div className="text-2xl font-bold text-slate-900 font-mono-tabular mt-0.5">
                        {summaryStats.lineB.totalOnline.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                        เฉลี่ย {summaryStats.lineB.avgOnlineUph} UPH (เป้า{' '}
                        {lineConfigs['Production Line B'].targetOnlineUph})
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Total Offline Qty (SFG)</div>
                      <div className="text-2xl font-bold text-slate-900 font-mono-tabular mt-0.5">
                        {summaryStats.lineB.totalOffline.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                        เฉลี่ย {summaryStats.lineB.avgOfflineUph} UPH (เป้า{' '}
                        {lineConfigs['Production Line B'].targetOfflineUph})
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 flex flex-wrap items-center justify-between text-xs text-slate-600 font-mono-tabular gap-2">
                    <span>จำนวนชั่วโมง: {summaryStats.lineB.hoursCount} ชม.</span>
                    <span>·</span>
                    <span>งานเสีย (NG): {summaryStats.lineB.totalNg} ชิ้น</span>
                    <span>·</span>
                    <span className="text-red-600 font-semibold">
                      ผิดปกติ: {summaryStats.lineB.anomalyCount} ช่วงเวลา
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setLineFilter('Production Line B');
                      setActiveTab('hourly_report');
                    }}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    ดูตารางรายงาน Line B (478 / 414) →
                  </button>
                  <button
                    type="button"
                    onClick={() => openAddLogModal('Production Line B')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer"
                  >
                    + บันทึก Line B
                  </button>
                </div>
              </div>

              {/* Combined Daily Factory Summary & Balance Card */}
              <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
                <div>
                  <div className="pb-3 border-b border-slate-100">
                    <div className="text-xs text-slate-500">สรุปยอดผลิตรวมทั้งโรงงาน (Line A + Line B)</div>
                    <h2 className="text-lg font-bold text-slate-900">Daily Plant Summary</h2>
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-4 border-b border-slate-100">
                    <div>
                      <div className="text-xs text-slate-500">รวม Online ทั้งหมด</div>
                      <div className="text-2xl font-bold text-blue-600 font-mono-tabular mt-0.5">
                        {summaryStats.totalOnlineAll.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                        Line A ({summaryStats.lineA.totalOnline}) + Line B ({summaryStats.lineB.totalOnline})
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">รวม Offline ทั้งหมด</div>
                      <div className="text-2xl font-bold text-teal-700 font-mono-tabular mt-0.5">
                        {summaryStats.totalOfflineAll.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                        Line A ({summaryStats.lineA.totalOffline}) + Line B ({summaryStats.lineB.totalOffline})
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 space-y-1.5 text-xs text-slate-600">
                    <div className="flex items-center justify-between font-mono-tabular">
                      <span>ส่วนต่างสะสม (Online - Offline WIP):</span>
                      <span className="font-semibold text-slate-900">
                        {summaryStats.totalOnlineAll - summaryStats.totalOfflineAll > 0 ? '+' : ''}
                        {summaryStats.totalOnlineAll - summaryStats.totalOfflineAll} ชิ้น
                      </span>
                    </div>
                    <div className="flex items-center justify-between font-mono-tabular">
                      <span>การแจ้งเตือนที่ต้องติดตาม:</span>
                      <span
                        className={
                          summaryStats.openAlertsCount > 0
                            ? 'font-semibold text-red-600'
                            : 'font-semibold text-emerald-700'
                        }
                      >
                        {summaryStats.openAlertsCount} รายการ
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setActiveTab('comparison')}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    วิเคราะห์เปรียบเทียบเชิงลึก →
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('alerts')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer"
                  >
                    จัดการแจ้งเตือน
                  </button>
                </div>
              </div>
            </div>

            {/* Interactive Efficiency Comparison Charts */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
              <div className="xl:col-span-2">
                <HourlyComparisonChart
                  logs={logs.filter(
                    (l) =>
                      (!startTimeFilter || l.timeRange >= startTimeFilter) &&
                      (!endTimeFilter || l.timeRange <= endTimeFilter)
                  )}
                  metricMode={chartMetricMode}
                  onMetricModeChange={setChartMetricMode}
                  targetLineA={
                    chartMetricMode === 'online'
                      ? lineConfigs['Production Line A'].targetOnlineUph
                      : chartMetricMode === 'offline'
                      ? lineConfigs['Production Line A'].targetOfflineUph
                      : lineConfigs['Production Line A'].targetOnlineUph +
                        lineConfigs['Production Line A'].targetOfflineUph
                  }
                  targetLineB={
                    chartMetricMode === 'online'
                      ? lineConfigs['Production Line B'].targetOnlineUph
                      : chartMetricMode === 'offline'
                      ? lineConfigs['Production Line B'].targetOfflineUph
                      : lineConfigs['Production Line B'].targetOnlineUph +
                        lineConfigs['Production Line B'].targetOfflineUph
                  }
                />
              </div>
              <div className="xl:col-span-1">
                <OnlineOfflineBalanceChart logs={logs} selectedLine={lineFilter} />
              </div>
            </div>

            {/* Embedded Hourly Production Report Section (Directly accessible from Overview too) */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    ตารางสรุปยอดการผลิตรายชั่วโมง (Hourly Production Report)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    คลิกเครื่องหมาย + หน้าแถวเพื่อดูรายละเอียดสถานีงาน, เวลาหยุดเครื่อง (Downtime) และแก้ไขข้อมูลได้ทันที
                  </p>
                </div>

                {/* Filter Bar matching uploaded MES screenshot */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    <label className="text-slate-600 font-medium whitespace-nowrap">
                      Start time:
                    </label>
                    <input
                      type="text"
                      value={startTimeFilter}
                      onChange={(e) => setStartTimeFilter(e.target.value)}
                      placeholder="2026-10-06 20:00"
                      className="w-36 px-2.5 py-1.5 text-xs font-mono-tabular border border-slate-300 rounded-md bg-white"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <label className="text-slate-600 font-medium whitespace-nowrap">
                      End time:
                    </label>
                    <input
                      type="text"
                      value={endTimeFilter}
                      onChange={(e) => setEndTimeFilter(e.target.value)}
                      placeholder="2026-10-07 02:00"
                      className="w-36 px-2.5 py-1.5 text-xs font-mono-tabular border border-slate-300 rounded-md bg-white"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <label className="text-slate-600 font-medium whitespace-nowrap">Line:</label>
                    <select
                      value={lineFilter}
                      onChange={(e) =>
                        setLineFilter(e.target.value as 'ALL' | ProductionLineName)
                      }
                      className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white font-medium text-slate-900"
                    >
                      <option value="Production Line B">Production Line B</option>
                      <option value="Production Line A">Production Line A</option>
                      <option value="ALL">All Lines (Line A + Line B)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* High-Density MES Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-700">
                      <th className="py-2.5 px-3 w-10 text-center"></th>
                      <th className="py-2.5 px-3 w-14 text-center">No.</th>
                      <th className="py-2.5 px-4">Time range</th>
                      <th className="py-2.5 px-4">Line</th>
                      <th className="py-2.5 px-4 text-right">Online qty</th>
                      <th className="py-2.5 px-4 text-right">Offline qty</th>
                      <th className="py-2.5 px-4 text-right">ส่วนต่าง (WIP)</th>
                      <th className="py-2.5 px-4">สถานะกระบวนการ</th>
                      <th className="py-2.5 px-4 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-10 text-center text-slate-500">
                          ไม่พบข้อมูลการผลิตในช่วงเวลาที่เลือก กรุณากด &ldquo;+ บันทึกยอดรายชั่วโมง&rdquo; หรือปรับตัวกรองเวลา
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((row, index) => {
                        const isExpanded = !!expandedRowIds[row.id];
                        const diff = row.onlineQty - row.offlineQty;
                        const isAnomaly = row.status === 'Anomaly';
                        const isWarning = row.status === 'Warning';

                        return (
                          <React.Fragment key={row.id}>
                            <tr
                              className={`transition-colors ${
                                isAnomaly
                                  ? 'bg-red-50/70 hover:bg-red-50'
                                  : index === 0
                                  ? 'bg-blue-50/40 hover:bg-slate-50'
                                  : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => toggleExpandRow(row.id)}
                                  className="inline-flex items-center justify-center w-5 h-5 border border-slate-300 bg-white rounded-xs text-slate-700 hover:bg-slate-100 cursor-pointer"
                                  title="แสดงรายละเอียดสถานีงาน"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono-tabular text-slate-700">
                                {index + 1}
                              </td>
                              <td className="py-2.5 px-4 font-mono-tabular font-medium text-slate-900">
                                {row.timeRange}
                              </td>
                              <td className="py-2.5 px-4 text-slate-800">{row.line}</td>
                              <td
                                className={`py-2.5 px-4 text-right font-mono-tabular font-semibold ${
                                  isAnomaly ? 'text-red-600' : 'text-slate-900'
                                }`}
                              >
                                {row.onlineQty}
                              </td>
                              <td
                                className={`py-2.5 px-4 text-right font-mono-tabular font-semibold ${
                                  isAnomaly ? 'text-red-600' : 'text-slate-900'
                                }`}
                              >
                                {row.offlineQty}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-600">
                                {diff > 0 ? `+${diff}` : diff}
                              </td>
                              <td className="py-2.5 px-4">
                                {isAnomaly ? (
                                  <span className="text-red-600 font-semibold">
                                    ผิดปกติ (UPH ตกต่ำกว่าเกณฑ์)
                                  </span>
                                ) : isWarning ? (
                                  <span className="text-amber-600 font-medium">
                                    เฝ้าระวัง (Online/Offline ต่างกัน {Math.abs(diff)} ชิ้น)
                                  </span>
                                ) : (
                                  <span className="text-emerald-700">ปกติ (Normal)</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-right">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => openEditLogModal(row)}
                                    className="text-slate-500 hover:text-blue-600 cursor-pointer"
                                    title="แก้ไข"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteLog(row)}
                                    className="text-slate-500 hover:text-red-600 cursor-pointer"
                                    title="ลบ"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr className="bg-slate-50/90 border-b border-slate-200">
                                <td colSpan={9} className="px-10 py-3 text-xs text-slate-600">
                                  <div className="flex flex-wrap items-center justify-between gap-4">
                                    <div className="flex flex-wrap items-center gap-4 font-mono-tabular">
                                      <span>
                                        กะ: <strong className="text-slate-900">{row.shift}</strong>
                                      </span>
                                      <span>·</span>
                                      <span>
                                        เป้า Online:{' '}
                                        <strong className="text-slate-900">
                                          {row.onlineQty}/{row.targetOnlineQty} UPH
                                        </strong>
                                      </span>
                                      <span>·</span>
                                      <span>
                                        เป้า Offline:{' '}
                                        <strong className="text-slate-900">
                                          {row.offlineQty}/{row.targetOfflineQty} UPH
                                        </strong>
                                      </span>
                                      <span>·</span>
                                      <span>
                                        งานเสีย (NG):{' '}
                                        <strong className="text-slate-900">{row.ngQty} ชิ้น</strong>
                                      </span>
                                      <span>·</span>
                                      <span>
                                        เวลาเครื่องหยุด (Downtime):{' '}
                                        <strong className="text-slate-900">
                                          {row.downtimeMinutes} นาที
                                        </strong>
                                      </span>
                                    </div>
                                    <div className="text-slate-700">
                                      หมายเหตุหน้างาน: <span className="font-medium">{row.operatorNote}</span>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Exact MES Summary Footer Bar */}
              <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-4 text-xs font-mono-tabular">
                <div className="text-slate-500">
                  แสดงผลตามเงื่อนไข: {lineFilter === 'ALL' ? 'All Production Lines' : lineFilter}
                </div>
                <div className="font-bold text-slate-900 text-sm tracking-tight">
                  Row qty:{tableFooterTotals.rowQty}, Total online qty:
                  {tableFooterTotals.totalOnlineQty}, Total offline qty:
                  {tableFooterTotals.totalOfflineQty}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 2: HOURLY PRODUCTION REPORT (Full MES Report View)
           =================================================================== */}
        {activeTab === 'hourly_report' && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-2xs">
            {/* Simulated MES Sub-Window Header Tabs */}
            <div className="bg-slate-800 text-slate-200 px-4 pt-2 flex items-center gap-1 text-xs border-b border-slate-700">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className="px-3.5 py-2 rounded-t-md bg-slate-700/60 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                Home
              </button>
              <button
                type="button"
                onClick={() => {
                  setChartMetricMode('offline');
                  setActiveTab('overview');
                }}
                className="px-3.5 py-2 rounded-t-md bg-slate-700/60 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                SFG Offline
              </button>
              <div className="px-4 py-2 rounded-t-md bg-white text-slate-900 font-semibold">
                Hourly Production Report
              </div>
            </div>

            {/* MES Filter Controls */}
            <div className="p-4 border-b border-slate-200 bg-slate-50/60 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2 text-xs">
                    <label className="font-medium text-slate-700">Start time:</label>
                    <input
                      type="text"
                      value={startTimeFilter}
                      onChange={(e) => setStartTimeFilter(e.target.value)}
                      className="px-3 py-1.5 text-xs font-mono-tabular border border-slate-300 rounded-md bg-white text-slate-900 w-40"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <label className="font-medium text-slate-700">End time:</label>
                    <input
                      type="text"
                      value={endTimeFilter}
                      onChange={(e) => setEndTimeFilter(e.target.value)}
                      className="px-3 py-1.5 text-xs font-mono-tabular border border-slate-300 rounded-md bg-white text-slate-900 w-40"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <label className="font-medium text-slate-700">Line:</label>
                    <select
                      value={lineFilter}
                      onChange={(e) =>
                        setLineFilter(e.target.value as 'ALL' | ProductionLineName)
                      }
                      className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 font-medium"
                    >
                      <option value="Production Line B">✓ Production Line B</option>
                      <option value="Production Line A">✓ Production Line A</option>
                      <option value="ALL">✓ All Lines (Line A &amp; Line B)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="ค้นหาเวลา / หมายเหตุ..."
                      className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white w-44"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openAddLogModal()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>เพิ่มแถวเวลา</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Full Report Grid */}
            <div className="overflow-x-auto min-h-[360px]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-xs font-semibold text-slate-700">
                    <th className="py-2.5 px-3 w-10 text-center border-r border-slate-200"></th>
                    <th className="py-2.5 px-3 w-16 text-center border-r border-slate-200">No.</th>
                    <th className="py-2.5 px-4 border-r border-slate-200">Time range</th>
                    <th className="py-2.5 px-4 border-r border-slate-200">Line</th>
                    <th className="py-2.5 px-4 text-center border-r border-slate-200">
                      Online qty
                    </th>
                    <th className="py-2.5 px-4 text-center border-r border-slate-200">
                      Offline qty
                    </th>
                    <th className="py-2.5 px-4 border-r border-slate-200">หมายเหตุ / สถานะ</th>
                    <th className="py-2.5 px-4 text-right">แก้ไข / ลบ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredLogs.map((row, idx) => {
                    const isExpanded = !!expandedRowIds[row.id];
                    const isAnomaly = row.status === 'Anomaly';
                    return (
                      <React.Fragment key={row.id}>
                        <tr
                          className={`${
                            idx === 0
                              ? 'bg-sky-100/70'
                              : isAnomaly
                              ? 'bg-red-50/70'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-3 text-center border-r border-slate-200">
                            <button
                              type="button"
                              onClick={() => toggleExpandRow(row.id)}
                              className="inline-flex items-center justify-center w-4 h-4 border border-slate-400 bg-white text-slate-700 text-[10px] leading-none cursor-pointer"
                            >
                              {isExpanded ? '-' : '+'}
                            </button>
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono-tabular border-r border-slate-200">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-4 font-mono-tabular text-center border-r border-slate-200">
                            {row.timeRange}
                          </td>
                          <td className="py-2.5 px-4 text-center border-r border-slate-200">
                            {row.line}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-center font-mono-tabular font-semibold border-r border-slate-200 ${
                              isAnomaly ? 'text-red-600' : 'text-slate-900'
                            }`}
                          >
                            {row.onlineQty}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-center font-mono-tabular font-semibold border-r border-slate-200 ${
                              isAnomaly ? 'text-red-600' : 'text-slate-900'
                            }`}
                          >
                            {row.offlineQty}
                          </td>
                          <td className="py-2.5 px-4 border-r border-slate-200 text-slate-600">
                            {row.status === 'Anomaly' ? (
                              <span className="text-red-600 font-semibold">
                                [ผิดปกติ] {row.operatorNote}
                              </span>
                            ) : (
                              <span>{row.operatorNote}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openEditLogModal(row)}
                                className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded cursor-pointer"
                              >
                                แก้ไข
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteLog(row)}
                                className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded cursor-pointer"
                              >
                                ลบ
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50">
                            <td colSpan={8} className="px-8 py-3 text-xs text-slate-700">
                              <div className="flex flex-wrap items-center gap-6 font-mono-tabular">
                                <span>Target Online: {row.targetOnlineQty} UPH</span>
                                <span>Target Offline: {row.targetOfflineQty} UPH</span>
                                <span>NG Qty: {row.ngQty} ชิ้น</span>
                                <span>Downtime: {row.downtimeMinutes} นาที</span>
                                <span>Shift: {row.shift}</span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Exact Footer Bar matching uploaded screenshot */}
            <div className="bg-white border-t border-slate-300 px-6 py-3 flex items-center justify-end">
              <div className="font-mono-tabular font-bold text-sm text-slate-900">
                Row qty:{tableFooterTotals.rowQty}, Total online qty:
                {tableFooterTotals.totalOnlineQty}, Total offline qty:
                {tableFooterTotals.totalOfflineQty}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 3: LINE A vs LINE B COMPARISON (เปรียบเทียบประสิทธิภาพ Line A & B)
           =================================================================== */}
        {activeTab === 'comparison' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="pb-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    ตารางเปรียบเทียบยอดผลิตรายชั่วโมงแบบประกบคู่ (Line A vs Line B Head-to-Head)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    วิเคราะห์ความแตกต่างของอัตราการผลิต Online และ Offline ในแต่ละชั่วโมงเพื่อหาคอขวด (Bottleneck)
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto mt-4">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-700">
                      <th className="py-2.5 px-4">ช่วงเวลา (Time range)</th>
                      <th className="py-2.5 px-4 text-right">Line A Online</th>
                      <th className="py-2.5 px-4 text-right">Line A Offline</th>
                      <th className="py-2.5 px-4 text-right bg-blue-50/60">รวม Line A</th>
                      <th className="py-2.5 px-4 text-right">Line B Online</th>
                      <th className="py-2.5 px-4 text-right">Line B Offline</th>
                      <th className="py-2.5 px-4 text-right bg-teal-50/60">รวม Line B</th>
                      <th className="py-2.5 px-4 text-right">ส่วนต่าง (A - B)</th>
                      <th className="py-2.5 px-4">สรุปผลรายชั่วโมง</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs font-mono-tabular">
                    {comparisonHours.map((item) => (
                      <tr key={item.timeRange} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-semibold text-slate-900">
                          {item.timeRange}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-700">
                          {item.recA?.onlineQty ?? '-'}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-700">
                          {item.recA?.offlineQty ?? '-'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold text-blue-700 bg-blue-50/30">
                          {item.totalA}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right ${
                            item.recB?.status === 'Anomaly'
                              ? 'text-red-600 font-bold'
                              : 'text-slate-700'
                          }`}
                        >
                          {item.recB?.onlineQty ?? '-'}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right ${
                            item.recB?.status === 'Anomaly'
                              ? 'text-red-600 font-bold'
                              : 'text-slate-700'
                          }`}
                        >
                          {item.recB?.offlineQty ?? '-'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold text-teal-700 bg-teal-50/30">
                          {item.totalB}
                        </td>
                        <td className="py-2.5 px-4 text-right font-semibold">
                          {item.diffAB > 0 ? `+${item.diffAB}` : item.diffAB}
                        </td>
                        <td className="py-2.5 px-4 font-sans">
                          {item.recB?.status === 'Anomaly' ? (
                            <span className="text-red-600 font-semibold">
                              Line B เกิดปัญหาหยุดชะงัก ({item.recB.onlineQty}/{item.recB.offlineQty})
                            </span>
                          ) : item.totalB > item.totalA ? (
                            <span className="text-teal-700 font-medium">
                              Line B ผลิตได้สูงกว่า (+{item.totalB - item.totalA} ชิ้น)
                            </span>
                          ) : (
                            <span className="text-blue-700 font-medium">
                              Line A เสถียรกว่า (+{item.totalA - item.totalB} ชิ้น)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-300 text-xs font-mono-tabular font-bold text-slate-900">
                      <td className="py-3 px-4">รวมทั้งหมด ({comparisonHours.length} ชม.)</td>
                      <td className="py-3 px-4 text-right">{summaryStats.lineA.totalOnline}</td>
                      <td className="py-3 px-4 text-right">{summaryStats.lineA.totalOffline}</td>
                      <td className="py-3 px-4 text-right text-blue-700">
                        {summaryStats.lineA.combinedQty}
                      </td>
                      <td className="py-3 px-4 text-right">{summaryStats.lineB.totalOnline}</td>
                      <td className="py-3 px-4 text-right">{summaryStats.lineB.totalOffline}</td>
                      <td className="py-3 px-4 text-right text-teal-700">
                        {summaryStats.lineB.combinedQty}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {summaryStats.lineA.combinedQty - summaryStats.lineB.combinedQty > 0
                          ? `+${summaryStats.lineA.combinedQty - summaryStats.lineB.combinedQty}`
                          : summaryStats.lineA.combinedQty - summaryStats.lineB.combinedQty}
                      </td>
                      <td className="py-3 px-4 font-sans">
                        Line A บรรลุเป้า {summaryStats.lineA.achievementPct}% · Line B บรรลุเป้า{' '}
                        {summaryStats.lineB.achievementPct}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 4: ANOMALY ALERTS (ระบบแจ้งเตือนเมื่อเกิดความผิดปกติในกระบวนการผลิต)
           =================================================================== */}
        {activeTab === 'alerts' && (
          <div className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  ศูนย์ควบคุมและแจ้งเตือนความผิดปกติในกระบวนการผลิต (Process Anomaly Center)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  ระบบตรวจจับอัตโนมัติเมื่อยอด Online/Offline ตกต่ำกว่าเกณฑ์ขั้นต่ำ, เกิดความไม่สมดุลของ WIP หรือเครื่องจักรหยุดทำงาน
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['ALL', 'Open', 'Acknowledged', 'Resolved'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setAlertStatusFilter(st)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        alertStatusFilter === st
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st === 'ALL' ? 'ทั้งหมด' : st}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setIsAlertModalOpen(true)}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors cursor-pointer"
                >
                  + แจ้งเหตุผิดปกติใหม่
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {alerts
                .filter((a) => alertStatusFilter === 'ALL' || a.status === alertStatusFilter)
                .map((alertItem) => {
                  const isCritical = alertItem.severity === 'Critical';
                  const isResolved = alertItem.status === 'Resolved';
                  const draftVal =
                    rootCauseDrafts[alertItem.id] !== undefined
                      ? rootCauseDrafts[alertItem.id]
                      : alertItem.rootCause;

                  return (
                    <div
                      key={alertItem.id}
                      className={`bg-white border rounded-lg p-5 ${
                        isResolved
                          ? 'border-slate-200 opacity-85'
                          : isCritical
                          ? 'border-red-300'
                          : 'border-amber-300'
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tabular">
                            <span
                              className={`font-bold ${
                                isResolved
                                  ? 'text-emerald-700'
                                  : isCritical
                                  ? 'text-red-600'
                                  : 'text-amber-600'
                              }`}
                            >
                              [{alertItem.severity.toUpperCase()}]
                            </span>
                            <span className="text-slate-700 font-semibold">{alertItem.line}</span>
                            <span>·</span>
                            <span className="text-slate-600">ช่วงเวลา {alertItem.timeRange}</span>
                            <span>·</span>
                            <span className="text-slate-600">ประเภท: {alertItem.alertType}</span>
                            <span>·</span>
                            <span className="font-semibold text-slate-900">
                              สถานะ: {alertItem.status}
                            </span>
                          </div>

                          <h3 className="text-sm font-bold text-slate-900">{alertItem.title}</h3>
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {alertItem.description}
                          </p>
                        </div>

                        {!isResolved && (
                          <div className="flex items-center gap-2 shrink-0">
                            {alertItem.status === 'Open' && (
                              <button
                                type="button"
                                onClick={() => handleUpdateAlertStatus(alertItem, 'Acknowledged')}
                                className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 cursor-pointer"
                              >
                                รับทราบเหตุการณ์ (Acknowledge)
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleUpdateAlertStatus(alertItem, 'Resolved')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>บันทึกการแก้ไข (Resolve)</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Root Cause & Corrective Action Input */}
                      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
                        <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
                          สาเหตุและการแก้ไข (Root Cause / Action):
                        </label>
                        {isResolved ? (
                          <span className="text-xs text-slate-800 font-medium">
                            {alertItem.rootCause || 'ดำเนินการแก้ไขเรียบร้อยแล้ว'}
                          </span>
                        ) : (
                          <input
                            type="text"
                            value={draftVal}
                            onChange={(e) =>
                              setRootCauseDrafts((prev) => ({
                                ...prev,
                                [alertItem.id]: e.target.value,
                              }))
                            }
                            placeholder="ระบุสาเหตุ เช่น ปรับตั้ง Feeder ใหม่, เคลียร์งานค้างสถานี Offline, เปลี่ยนใบมีด..."
                            className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 5: THRESHOLDS & SETTINGS (ตั้งค่าเป้าหมาย UPH & เกณฑ์แจ้งเตือน)
           =================================================================== */}
        {activeTab === 'settings' && (
          <form onSubmit={handleSaveLineConfigs} className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    ตั้งค่าเป้าหมายการผลิต (Target UPH) และเกณฑ์ตรวจจับความผิดปกติอัตโนมัติ
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    เมื่อบันทึกยอดผลิตรายชั่วโมง ระบบจะนำค่าเหล่านี้ไปตรวจสอบและสร้างใบแจ้งเตือนทันทีหากยอดต่ำกว่าเกณฑ์
                  </p>
                </div>
                <Sliders className="w-5 h-5 text-slate-400" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                {(['Production Line A', 'Production Line B'] as ProductionLineName[]).map(
                  (lineKey) => {
                    const cfg = configDraft[lineKey];
                    const updateField = (
                      field: keyof Omit<LineConfigRecord, 'id' | 'ownerId' | 'line' | 'updatedAt'>,
                      val: number
                    ) => {
                      setConfigDraft((prev) => ({
                        ...prev,
                        [lineKey]: {
                          ...prev[lineKey],
                          [field]: val,
                        },
                      }));
                    };

                    return (
                      <div
                        key={lineKey}
                        className="border border-slate-200 rounded-lg p-5 space-y-4 bg-slate-50/50"
                      >
                        <h3 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-2">
                          {lineKey}
                        </h3>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Target Online UPH (ชิ้น/ชม.)
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={100000}
                              value={cfg.targetOnlineUph}
                              onChange={(e) =>
                                updateField('targetOnlineUph', Number(e.target.value))
                              }
                              className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Target Offline UPH (ชิ้น/ชม.)
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={100000}
                              value={cfg.targetOfflineUph}
                              onChange={(e) =>
                                updateField('targetOfflineUph', Number(e.target.value))
                              }
                              className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              เกณฑ์ขั้นต่ำ Online (แจ้งเตือนเมื่อต่ำกว่า)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={100000}
                              value={cfg.minOnlineThreshold}
                              onChange={(e) =>
                                updateField('minOnlineThreshold', Number(e.target.value))
                              }
                              className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              เกณฑ์ขั้นต่ำ Offline (แจ้งเตือนเมื่อต่ำกว่า)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={100000}
                              value={cfg.minOfflineThreshold}
                              onChange={(e) =>
                                updateField('minOfflineThreshold', Number(e.target.value))
                              }
                              className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md bg-white"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            ส่วนต่างสูงสุดที่ยอมรับได้ระหว่าง Online และ Offline (ชิ้น/ชม.)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100000}
                            value={cfg.maxImbalanceGap}
                            onChange={(e) =>
                              updateField('maxImbalanceGap', Number(e.target.value))
                            }
                            className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md bg-white"
                          />
                        </div>
                      </div>
                    );
                  }
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfigDraft(DEFAULT_LINE_CONFIGS)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer"
                >
                  คืนค่ามาตรฐาน
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 cursor-pointer"
                >
                  บันทึกการตั้งค่าเกณฑ์ UPH
                </button>
              </div>
            </div>
          </form>
        )}
      </main>

      {/* Modal: Add / Edit Hourly Production Log */}
      {isLogModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                {editingLog
                  ? 'แก้ไขข้อมูลยอดผลิตรายชั่วโมง'
                  : 'บันทึกยอดผลิตรายชั่วโมง (Hourly UPH Entry)'}
              </h3>
              <button
                type="button"
                onClick={() => setIsLogModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProductionLog} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ช่วงเวลา (Time range)
                  </label>
                  <input
                    type="text"
                    required
                    value={formTimeRange}
                    onChange={(e) => setFormTimeRange(e.target.value)}
                    placeholder="2026-10-07 02:00"
                    className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    สายการผลิต (Line)
                  </label>
                  <select
                    value={formLine}
                    onChange={(e) => setFormLine(e.target.value as ProductionLineName)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    <option value="Production Line A">Production Line A</option>
                    <option value="Production Line B">Production Line B</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Online qty (ชิ้น)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    required
                    value={formOnlineQty}
                    onChange={(e) => setFormOnlineQty(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Offline qty (SFG ชิ้น)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    required
                    value={formOfflineQty}
                    onChange={(e) => setFormOfflineQty(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    งานเสีย NG (ชิ้น)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    value={formNgQty}
                    onChange={(e) => setFormNgQty(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Downtime (นาที)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={formDowntime}
                    onChange={(e) => setFormDowntime(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">กะ (Shift)</label>
                  <select
                    value={formShift}
                    onChange={(e) => setFormShift(e.target.value as ShiftName)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    <option value="Night Shift">Night Shift</option>
                    <option value="Day Shift">Day Shift</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  หมายเหตุหน้างาน / สาเหตุกรณี UPH ตก
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="เช่น เดินเครื่องปกติ หรือ พักเบรก / ปรับตั้ง Feeder"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsLogModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
                >
                  บันทึกข้อมูล
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Manual Alert Creation */}
      {isAlertModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                แจ้งเหตุผิดปกติในกระบวนการผลิต (Report Process Anomaly)
              </h3>
              <button
                type="button"
                onClick={() => setIsAlertModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateManualAlert} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ช่วงเวลาเกิดเหตุ
                  </label>
                  <input
                    type="text"
                    required
                    value={alertTimeRange}
                    onChange={(e) => setAlertTimeRange(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    สายการผลิต
                  </label>
                  <select
                    value={alertLine}
                    onChange={(e) => setAlertLine(e.target.value as ProductionLineName)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    <option value="Production Line B">Production Line B</option>
                    <option value="Production Line A">Production Line A</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ระดับความรุนแรง
                  </label>
                  <select
                    value={alertSeverity}
                    onChange={(e) => setAlertSeverity(e.target.value as AlertSeverity)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    <option value="Warning">Warning (เฝ้าระวัง)</option>
                    <option value="Critical">Critical (วิกฤต)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ประเภทความผิดปกติ
                  </label>
                  <select
                    value={alertType}
                    onChange={(e) => setAlertType(e.target.value as AlertType)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    <option value="UPH Drop">UPH Drop (ยอดผลิตตก)</option>
                    <option value="Online-Offline Imbalance">Online-Offline Imbalance</option>
                    <option value="Machine Downtime">Machine Downtime (เครื่องจักรขัดข้อง)</option>
                    <option value="High Defect Rate">High Defect Rate (ของเสียสูง)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  หัวข้อปัญหา (Title)
                </label>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={alertTitle}
                  onChange={(e) => setAlertTitle(e.target.value)}
                  placeholder="เช่น เซนเซอร์ตรวจจับชิ้นงานสถานี Online ขัดข้อง"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  รายละเอียดอาการและผลกระทบ
                </label>
                <textarea
                  rows={3}
                  required
                  maxLength={500}
                  value={alertDesc}
                  onChange={(e) => setAlertDesc(e.target.value)}
                  placeholder="ระบุรายละเอียดความผิดปกติที่พบในสายการผลิต..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAlertModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-700"
                >
                  บันทึกการแจ้งเตือน
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Paste / Import MES Data */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportRows={handleBatchImport}
      />
    </div>
  );
}
