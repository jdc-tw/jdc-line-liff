/**
 * UI 驗收用假資料（不含任何真實同仁姓名，可安全外流）。
 * 刻意涵蓋：零素食的桌、同桌多素食、未排桌素食、跨兩桌的同名廠商。
 * 預期彙總＝1 桌 3 份／2 桌 1 份／未排桌 1 份／合計 5／splitVendors=['某某工程行']
 */
module.exports = {
  ok: true, who: '驗收用', actId: 'actTEST', actName: '驗收用活動',
  published: false, pubState: 'none', vegReady: true,
  ranks: { '副理': 10, '課長': 20 },
  guestVendors: 2, guestSeats: 3,
  seats: [
    { kind: 'emp', id: 'U1', name: '甲一', unit: '管理部', title: '副理', empNo: 'A01', table: '1', veg: true,  changed: false },
    { kind: 'emp', id: 'U2', name: '乙二', unit: '管理部', title: '課長', empNo: 'A02', table: '1', veg: false, changed: false },
    { kind: 'emp', id: 'U3', name: '丙三', unit: '工務部', title: '',     empNo: 'A03', table: '1', veg: true,  changed: true  },
    { kind: 'emp', id: 'U4', name: '丁四', unit: '工務部', title: '',     empNo: 'A04', table: '2', veg: false, changed: false },
    { kind: 'emp', id: 'U5', name: '戊五', unit: '工務部', title: '',     empNo: 'A05', table: '',  veg: true,  changed: false },
    { kind: 'guest', id: '2', name: '某某工程行', unit: '甲一', title: '', empNo: '', note: '', table: '1', veg: true,  changed: false },
    { kind: 'guest', id: '3', name: '某某工程行', unit: '甲一', title: '', empNo: '', note: '', table: '2', veg: true,  changed: false },
    { kind: 'guest', id: '4', name: '另一家',     unit: '乙二', title: '', empNo: '', note: '', table: '2', veg: false, changed: false },
  ],
};
