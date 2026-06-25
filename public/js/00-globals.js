// ════════════════════════════════════════
// CONSTANTS — magic strings tập trung tại đây
// ════════════════════════════════════════

const STATUS = Object.freeze({
  ROOM: Object.freeze({
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    RENTED: 'rented',
    EXPIRED: 'expired',
  }),
  PAYMENT: Object.freeze({
    WAITING: 'waiting_for_payment',
    PAID_PENDING: 'paid_waiting_admin',
    PAID: 'paid',
    CANCELLED: 'cancelled',
    REJECTED: 'rejected',
  }),
  VERIFY: Object.freeze({
    PENDING: 'pending',
    PENDING_ADMIN: 'pending_admin_review',
    QUEUED_MANUAL: 'queued_manual',
    APPROVED: 'approved',
    REJECTED: 'rejected',
  }),
  APPT: Object.freeze({
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    TENANT_CONFIRMED: 'tenant_confirmed',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled',
    CANCELLED_BY_LANDLORD: 'cancelled_by_landlord',
    CANCELLED_BY_SYSTEM: 'cancelled_by_system',
    EXPIRED_PENDING: 'expired_pending',
    NO_SHOW: 'no_show',
    COMPLETED: 'completed',
    RENTED: 'rented',
  }),
});

// ════════════════════════════════════════
// GLOBAL STATE & VARIABLES
// ════════════════════════════════════════

// -- Listeners & Timers --
let activeListeners = [];
let postsSearchTimeout;
let usersSearchTimeout;
let paymentsSearchTimeout;
let usersRealtimeRefreshTimer = null;
let playEntrySplashOnNextAuth = false;
let entrySplashTimer = null;
const ENTRY_SPLASH_MS = 1650;

// -- Pagination & Data State --
const PAGE_SIZE = 20;

// Giới hạn tối đa load khi search client-side (thay vì 2000)
const MAX_SEARCH_DOCS = 300;

const CF_DELETE_USER_URL =
  'https://asia-southeast1-doantotnghiep-b39ae.cloudfunctions.net/deleteUserAccount';

const state = {
  posts: { docs: [], page: 1, sort: 'newest' },
  users: { docs: [], page: 1, sort: 'newest' },
  support: { docs: [], page: 1, sort: 'newest' },
  featured: { docs: [], page: 1, sort: 'newest' },
  payments: { docs: [], page: 1, sort: 'newest' },
};

// -- Server-side cursor pagination state --
// active=true  → dùng Firestore startAfter (load PAGE_SIZE/lần, rất tiết kiệm read)
// active=false → load MAX_SEARCH_DOCS, filter client-side (khi có search/sort phức tạp)
const cursorMode = {
  posts: {
    active: false,
    pageStarts: [null], // pageStarts[i] = cursor doc bắt đầu trang i (null = đầu collection)
    currentPage: 0,
    hasMore: false,
    filter: 'all',
  },
  users: {
    active: false,
    pageStarts: [null],
    currentPage: 0,
    hasMore: false,
    filter: 'all',
  },
};

// -- Filters & Selections --
let postsSearchKeyword = '';
let postsPhuongFilter = '';
let postsXaFilter = '';
let usersSearchKeyword = '';
let featuredSearchKw = '';
let paymentsSearchKw = '';

const selectedPostIds = new Set();
const selectedUserIds = new Set();
const selectedFeaturedIds = new Set();
const selectedPaymentsIds = new Set();
const selectedSupportIds = new Set();
