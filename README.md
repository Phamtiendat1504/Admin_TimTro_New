# WEB ADMIN - TIM TRO 24/7

`Admin_TimTro_New` là giao diện quản trị web dành cho hệ sinh thái `TIM TRO 24/7`. Nếu ứng dụng Android là nơi người dùng tìm phòng, đăng bài, chat và đặt lịch, thì web admin là nơi quản trị viên theo dõi, duyệt, điều phối và xử lý toàn bộ dữ liệu phía sau hệ thống.

Tài liệu này được viết lại theo hướng dành cho người mới mở project lần đầu. Mục tiêu là giúp bạn hiểu nhanh:
- web admin này dùng để làm gì,
- dữ liệu đang đi qua đâu,
- từng khu vực giao diện có nhiệm vụ gì,
- `public/app.js` đang điều phối những luồng nào,
- Cloud Functions hỗ trợ phần gì,
- và web admin liên hệ thế nào với app Android.

---

## 1. Bức tranh tổng thể của hệ thống

Hệ thống `TIM TRO 24/7` gồm hai lớp giao diện chính:

### 1.1 Ứng dụng Android
Dành cho người dùng cuối và chủ trọ:
- tìm phòng,
- xem chi tiết bài đăng,
- lưu bài,
- chat,
- đặt lịch xem phòng,
- đăng bài cho thuê,
- xác minh CCCD,
- theo dõi thông báo,
- quản lý hồ sơ cá nhân.

### 1.2 Web admin
Dành cho quản trị viên:
- kiểm duyệt bài đăng,
- kiểm tra hồ sơ xác minh,
- quản lý người dùng,
- xử lý khóa / mở khóa tài khoản,
- theo dõi thanh toán,
- xem thống kê hệ thống,
- xử lý ticket hỗ trợ,
- can thiệp khi có dữ liệu sai hoặc spam.

Nói ngắn gọn, web admin là “phòng điều khiển” của toàn bộ hệ thống.

---

## 2. Công nghệ sử dụng

### 2.1 Frontend web
Web admin được viết bằng các công nghệ web cơ bản:
- **HTML** để dựng khung giao diện,
- **CSS** để tạo bố cục, màu sắc và hiệu ứng,
- **JavaScript** để xử lý logic.

### 2.2 Firebase
Web admin dùng chung backend Firebase với app Android.

Các dịch vụ Firebase quan trọng:
- **Authentication**: xác thực tài khoản admin,
- **Firestore**: lưu và đọc dữ liệu hệ thống,
- **Storage**: lưu ảnh CCCD, ảnh phòng, avatar,
- **Cloud Functions**: xử lý các nghiệp vụ tự động và các thao tác server-side.

### 2.3 Thư viện / công cụ hỗ trợ
- **Chart.js**: vẽ biểu đồ thống kê,
- **Font Awesome**: icon giao diện,
- **Be Vietnam Pro**: font chữ chính,
- **firebase-admin**: thao tác Firebase từ backend / function,
- **jsdom**: hỗ trợ xử lý DOM trong môi trường Node khi cần.

---

## 3. Cấu trúc thư mục chính

Dựa trên nội dung hiện tại của project, cấu trúc chính có thể hiểu như sau:

```text
Admin_TimTro_New/
├── public/
│   ├── index.html
│   ├── app.js
│   ├── ultra.css
│   ├── ultra.js
│   └── js/
│       ├── 00-globals.js
│       ├── 01-firebase-config.js
│       ├── 02-helpers.js
│       ├── 03-auth.js
│       ├── 04-navigation.js
│       ├── 05-dashboard.js
│       ├── 06-verifications.js
│       ├── 07-posts.js
│       ├── 08-users.js
│       ├── 09-exports.js
│       ├── 10-appointments.js
│       ├── 11-support.js
│       └── 12-utils.js
├── phamtriendat_doantotnghiep/
│   ├── index.js
│   └── ...
├── package.json
├── package-lock.json
├── generate_data.js
├── firestore.rules
├── storage.rules
├── firebase.json
└── README.md
```

### 3.1 `public/index.html`
Đây là file khung giao diện chính của admin panel. Nó chứa:
- sidebar,
- topbar,
- dashboard cards,
- bảng dữ liệu,
- modal chi tiết,
- các nút thao tác quản trị.

### 3.2 `public/js/*`
Đây là các file JavaScript được tách nhỏ theo từng nhóm logic để dễ quản lý hơn.

### 3.3 `public/ultra.css`
Chứa phần style giao diện: bố cục, màu sắc, card, bảng, button, badge, responsive và các hiệu ứng UI.

### 3.4 `public/ultra.js`
Chứa các logic giao diện phụ trợ, ví dụ một số tương tác, theme hoặc thao tác hỗ trợ hiển thị.

### 3.5 `phamtriendat_doantotnghiep/index.js`
Đây là file Cloud Functions. Nó xử lý các tác vụ server-side như:
- OCR / kiểm tra CCCD,
- xóa user theo chuỗi dữ liệu liên quan,
- đồng bộ trạng thái thanh toán,
- tự động tắt bài nổi bật hết hạn,
- gửi push notification,
- dọn dữ liệu cũ.

---

## 4. Web admin dùng để làm gì?

Web admin không phải là giao diện dành cho người dùng thường. Nó là nơi quản trị viên can thiệp vào hệ thống ở mức cao hơn.

### Nhiệm vụ chính của admin
- kiểm tra dữ liệu hệ thống,
- duyệt bài đăng trước khi public,
- kiểm duyệt hồ sơ xác minh CCCD,
- xử lý tài khoản vi phạm,
- theo dõi giao dịch nâng cấp,
- quản lý ticket hỗ trợ,
- xem biểu đồ thống kê,
- hỗ trợ vận hành chung.

Nếu không có web admin, việc kiểm soát chất lượng dữ liệu và xử lý vi phạm sẽ rất khó thực hiện thủ công.

---

## 5. Luồng hoạt động tổng quát

Luồng xử lý chung của web admin có thể hiểu như sau:

```text
Admin đăng nhập
-> hệ thống kiểm tra role admin
-> tải dữ liệu từ Firestore
-> hiển thị dashboard / bảng quản trị
-> admin thao tác trên giao diện
-> web ghi ngược dữ liệu vào Firestore hoặc gọi Cloud Functions
-> backend xử lý tiếp
-> UI cập nhật lại kết quả
```

### Ý nghĩa
Web admin không tự lưu dữ liệu cục bộ như ứng dụng đơn lẻ. Nó hoạt động như một lớp điều khiển trực tiếp lên backend Firebase chung với app Android.

---

## 6. Các khu vực chức năng chính

## 6.1 Dashboard
Dashboard là màn hình tổng quan đầu tiên.

### Thường hiển thị
- tổng số bài đăng,
- số bài chờ duyệt,
- số người dùng,
- số hồ sơ xác minh,
- biểu đồ hoạt động theo thời gian,
- các mục gần nhất như bài mới, user mới.

### Mục đích
Giúp admin nhìn nhanh tình hình hệ thống mà không cần mở từng trang con.

---

## 6.2 Quản lý bài đăng
Đây là nơi admin xem và xử lý các bài phòng trọ.

### Các thao tác thường có
- xem danh sách bài,
- lọc theo trạng thái,
- mở chi tiết,
- duyệt bài,
- từ chối bài,
- xóa bài,
- lọc theo ngày,
- xuất dữ liệu ra Excel.

### Mục đích
Đảm bảo nội dung phòng trọ hiển thị đúng, sạch và hợp lệ trước khi đến tay người dùng.

---

## 6.3 Quản lý xác minh CCCD
Đây là nơi admin kiểm tra hồ sơ xác minh chủ trọ.

### Có thể làm gì
- xem ảnh mặt trước / mặt sau CCCD,
- xem thông tin người nộp,
- duyệt xác minh,
- từ chối xác minh,
- theo dõi trạng thái xử lý.

### Mục đích
Giảm tài khoản ảo và tăng độ tin cậy của hệ thống.

---

## 6.4 Quản lý người dùng
Đây là nơi admin quản trị tài khoản trong hệ thống.

### Có thể làm gì
- xem danh sách người dùng,
- lọc theo vai trò / trạng thái,
- mở chi tiết tài khoản,
- khóa tài khoản,
- mở khóa tài khoản,
- xóa tài khoản,
- xuất Excel.

### Mục đích
Xử lý tài khoản spam, tài khoản vi phạm hoặc tài khoản không còn hợp lệ.

---

## 6.5 Quản lý lịch hẹn
Admin có thể theo dõi lịch hẹn xem phòng của người dùng.

### Mục đích
- kiểm tra trạng thái đặt lịch,
- hỗ trợ xử lý khi có tranh chấp,
- thống kê hoạt động.

---

## 6.6 Quản lý thanh toán
Khu vực này dùng để quản lý các request thanh toán như:
- nâng cấp slot đăng bài,
- nâng cấp bài nổi bật,
- các giao dịch đang chờ xử lý.

### Mục đích
Giúp admin đối soát và cập nhật trạng thái giao dịch chính xác.

---

## 6.7 Quản lý hỗ trợ
Admin xem các ticket hỗ trợ từ người dùng.

### Mục đích
- tiếp nhận phản hồi,
- xử lý vấn đề,
- trả lời câu hỏi,
- theo dõi trạng thái ticket.

---

# 7. Bảng map từng file thành chức năng - hàm - dữ liệu đọc/ghi - collection liên quan

Bảng này dùng trực tiếp cho báo cáo để bạn chèn vào phần mô tả kỹ thuật của web admin.

## 7.1 `public/js/00-globals.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Lưu state toàn cục cho web | `state`, `activeListeners`, `selected*Ids`, `dashboardAllPostDocs`, `dashboardAllUserDocs` | Ghi / đọc state trong bộ nhớ tạm của frontend | Không trực tiếp |
| Phân trang | `PAGE_SIZE`, `state.posts.page`, `state.users.page`, ... | Ghi / đọc state page | Không trực tiếp |
| Tìm kiếm / lọc | `postsSearchKeyword`, `usersSearchKeyword`, `featuredSearchKw`, `paymentsSearchKw`, `reviewsSearchKw` | Ghi / đọc keyword local | Không trực tiếp |

## 7.2 `public/js/01-firebase-config.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Khởi tạo Firebase | `firebase.initializeApp`, `auth`, `db`, `storage` | Kết nối tới Firebase project | Tất cả collection |
| Kết nối Auth | `auth` | Đăng nhập / đăng xuất / kiểm tra role | `users` |
| Kết nối Firestore | `db` | Đọc / ghi dữ liệu hệ thống | `users`, `rooms`, `verifications`, ... |
| Kết nối Storage | `storage` | Upload / xóa ảnh | `avatars`, `rooms`, `verifications` |

## 7.3 `public/js/02-helpers.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Format dữ liệu | `fmt`, `fmtDate`, `fmtDateTime`, `toEpochMs` | Chỉ xử lý dữ liệu hiển thị | Không trực tiếp |
| Map trạng thái | `statusText`, `paymentStatusText`, `paymentStatusBadge` | Chỉ xử lý label / badge | Không trực tiếp |
| An toàn UI | `escapeHtml`, `safeUrl`, `safeForJsGlobal` | Làm sạch dữ liệu trước render | Không trực tiếp |
| Modal / toast | `showToast`, `showConfirm`, `showPrompt`, `showModal`, `closeModal` | Không ghi Firestore trực tiếp | Không trực tiếp |
| Thông báo | `sendNotification` | Ghi notification | `notifications` |

## 7.4 `public/js/03-auth.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Kiểm tra đăng nhập | `auth.onAuthStateChanged` | Đọc Auth user, rồi đọc `users/{uid}` | `users` |
| Đăng nhập admin | Click `btnLogin` | Ghi session Auth | `users` |
| Đăng xuất | Click `btnLogout` | Xóa session Auth | Không trực tiếp |
| Giao diện mobile menu | event listener sidebar | Chỉ thao tác UI | Không trực tiếp |

## 7.5 `public/js/04-navigation.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Điều hướng trang | `navigateTo(page)` | Đổi page UI, gọi hàm load | Gián tiếp tùy page |
| Khai báo page | `pageConfig` | Map tên page -> title / load function | Không trực tiếp |
| Xử lý tab | `bindTabs(groupId, loadFn)` | Cập nhật filter local và load lại dữ liệu | Tùy page |

## 7.6 `public/js/05-dashboard.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Realtime listener | `startRealtimeListeners`, `stopAllListeners` | Nghe thay đổi dữ liệu realtime | `users`, `rooms`, `verifications`, `notifications`, `reviews`, `featured_upgrade_requests` |
| Badge số lượng | `setBadge` | Cập nhật badge trên sidebar | Nhiều collection |
| Load dashboard | `loadDashboard` | Đọc thống kê, bài pending, user mới | `rooms`, `users` |
| Vẽ biểu đồ | `renderAggregatedCharts` | Dữ liệu aggregate | Không trực tiếp |

## 7.7 `public/js/06-verifications.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Xác minh legacy | `loadVerificationsLegacy`, `viewVerificationLegacy` | Đọc hồ sơ xác minh | `verifications` |
| Tương thích | logic cũ | Đọc / hiển thị hồ sơ | `verifications` |

## 7.8 `public/js/07-posts.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Load bài đăng | `loadPosts`, `renderPosts`, `viewPost` | Đọc / hiển thị rooms | `rooms` |
| Duyệt / từ chối bài | `approvePost`, `rejectPost` | Ghi status + notification | `rooms`, `notifications` |
| Xóa bài | `deletePost`, `deletePostRecordCompletely`, `deleteSelectedPosts` | Xóa rooms + Storage ảnh | `rooms`, Storage |
| Bài nổi bật | `loadFeaturedRequests`, `approveFeaturedRequest`, `rejectFeaturedRequest`, ... | Đọc / ghi request featured | `featured_upgrade_requests`, `rooms`, `notifications` |
| Thanh toán | `loadPayments`, `renderPayments`, `deletePaymentRecord`, ... | Đọc / xóa request thanh toán | `slot_upgrade_requests`, `featured_upgrade_requests` |
| Đánh giá | `loadReviews`, `viewReview`, `hideReview`, `showReview`, `deleteReview` | Đọc / sửa / xóa review | `reviews` |

## 7.9 `public/js/08-users.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Load users | `loadUsers`, `renderUsers`, `viewUser` | Đọc users + verifications | `users`, `verifications` |
| Mở / khóa user | `toggleLockUser`, `processLockUser`, `checkAndUnlockExpiredUsers` | Ghi `isLocked`, `lockReason`, `lockUntil`, notification | `users`, `notifications` |
| Xóa user | `deleteUser`, `deleteSelectedUsers` | Xóa Auth, Firestore, Storage, dữ liệu liên quan | `users`, `verifications`, `rooms`, `appointments`, `notifications`, `savedPosts`, `cccd_registry`, `bookedSlots`, Storage |
| Admin verification queue | `loadVerifications`, `viewVerification`, `approveVerification`, `rejectVerification` | Đọc / ghi verifications và users | `verifications`, `users`, `notifications` |

## 7.10 `public/js/09-exports.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Xuất dữ liệu | `exportUsersToExcel`, `exportPostsToExcel` | Đọc user / post để xuất file | `users`, `rooms` |
| Tạo tên file | `getExportFileName` | Không ghi Firestore | Không trực tiếp |

## 7.11 `public/js/10-appointments.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Load lịch hẹn | `loadAppointments`, `renderAppt` | Đọc danh sách appointment | `appointments` |
| Lọc / sắp xếp | `getFilteredAppointmentDocs`, `changeSortAppt` | Lọc local state | `appointments` |
| Xóa lịch hẹn | `deleteSelectedAppointments` | Xóa appointment docs | `appointments` |

## 7.12 `public/js/11-support.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Load ticket | `loadSupportTickets`, `renderSupportTickets` | Đọc ticket hỗ trợ | `support_tickets` |
| Xem / trả lời | `openSupportTicket`, `sendSupportReply` | Đọc / ghi ticket, message, notification | `support_tickets`, `support_messages`, `notifications` |
| Cập nhật trạng thái | `updateSupportStatus` | Ghi status ticket | `support_tickets` |
| Xóa ticket | `deleteSupportTicket`, `deleteSelectedSupport` | Xóa ticket và message con | `support_tickets`, `support_messages` |

## 7.13 `public/js/12-utils.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Lọc theo ngày | `dateFilterMap`, `dateFilterState`, `applyDateFilter`, `clearDateFilter`, `isInDateRange` | Lọc local state theo khoảng thời gian | Tùy page |
| Broadcast | `sendBroadcast` | Ghi thông báo hệ thống | `system_notifications` |
| Dọn user inactive | `scanInactiveUsers`, `deleteInactiveUser`, `deleteAllInactive` | Đọc / xóa user inactive | `users` |
| Tab đang active | `getActiveTab` | Đọc trạng thái UI | Không trực tiếp |

## 7.14 `public/ultra.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| UI phụ trợ | các helper UI bổ sung | Chỉ xử lý giao diện | Không trực tiếp |

## 7.15 `generate_data.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Sinh dữ liệu mẫu | các hàm tạo mock data | Ghi dữ liệu test | `users`, `rooms`, `reviews`, ... tùy script |

## 7.16 `phamtriendat_doantotnghiep/index.js`

| Chức năng | Hàm / biến chính | Dữ liệu đọc / ghi | Collection liên quan |
| --- | --- | --- | --- |
| Xóa user server-side | `deleteUserAccount` | Xóa Auth và dữ liệu server-side | `users`, Storage, liên quan |
| OCR / xác minh | `autoReviewVerificationByCloudVision` | Đọc ảnh CCCD, ghi kết quả check | `verifications` |
| Mở khóa tự động | `autoUnlockUsers` | Đọc user lock hết hạn và mở khóa | `users`, `notifications` |
| Dọn dữ liệu | `dailyDataCleanup` | Xóa dữ liệu cũ theo lịch | Nhiều collection |
| Thanh toán slot / featured | `processPendingSlotUpgradePayments`, `processPendingFeaturedUpgradePayments` | Đối soát giao dịch | `slot_upgrade_requests`, `featured_upgrade_requests`, `rooms` |
| Tắt featured hết hạn | `autoDisableExpiredFeaturedRooms` | Cập nhật bài nổi bật hết hạn | `rooms` |

---

# 8. Sơ đồ kiến trúc tổng thể

```text
+-----------------------------+
|         Admin Web           |
|  HTML + CSS + JS + Charts   |
+--------------+--------------+
               |
               | đọc / ghi
               v
+--------------+--------------+
|           Firebase          |
| Auth | Firestore | Storage  |
+--------------+--------------+
               |
       +-------+--------+
       |                |
       v                v
+-------------+   +----------------+
| Cloud Funcs |   | Android App    |
| server-side  |   | người dùng     |
+-------------+   +----------------+
```

## 8.1 Ý nghĩa sơ đồ
- Web admin là nơi thao tác quản trị.
- Firebase là trung tâm dữ liệu chung.
- Cloud Functions xử lý nghiệp vụ tự động hoặc thao tác server-side.
- App Android đọc lại trạng thái từ Firebase để phản ánh thay đổi ngay.

---

# 9. Sơ đồ luồng dữ liệu

## 9.1 Luồng duyệt bài đăng
```text
Android App -> Firestore (rooms)
             -> Web Admin loadPosts()
             -> Admin duyệt / từ chối
             -> Firestore cập nhật status
             -> Android App đọc lại và hiển thị trạng thái mới
```

## 9.2 Luồng xác minh CCCD
```text
Android App -> Storage (ảnh CCCD)
             -> Firestore (verifications)
             -> Web Admin loadVerifications()
             -> Admin duyệt / từ chối
             -> Firestore cập nhật users.isVerified / verification status
             -> Android App cập nhật quyền đăng bài
```

## 9.3 Luồng khóa / mở khóa tài khoản
```text
Web Admin -> Firestore (users.isLocked)
          -> notifications
          -> Android App đọc lại user state
          -> app chặn / mở quyền tương ứng
```

## 9.4 Luồng thanh toán nâng cấp
```text
Android App -> Firestore (slot_upgrade_requests / featured_upgrade_requests)
             -> Web Admin loadPayments() / loadFeaturedRequests()
             -> Admin duyệt giao dịch
             -> Firestore cập nhật trạng thái
             -> Android App nhận trạng thái mới
```

---

# 10. Gợi ý dùng phần này trong báo cáo

Nếu bạn đưa vào báo cáo, phần này rất phù hợp với:
- **Chương 2: Thiết kế hệ thống**
- **Chương 3: Triển khai ứng dụng**

Bạn có thể chèn theo thứ tự:
1. mô tả kiến trúc,
2. bảng map từng file,
3. sơ đồ kiến trúc,
4. sơ đồ luồng dữ liệu,
5. rồi mới sang phần kết quả triển khai.

---

# 11. Kết luận

Web admin của `TIM TRO 24/7` không phải một trang dashboard đơn giản, mà là một hệ thống quản trị có nhiều tầng:
- state chung,
- auth admin,
- navigation,
- dashboard realtime,
- quản lý posts,
- quản lý users,
- xác minh CCCD,
- thanh toán,
- đánh giá,
- lịch hẹn,
- hỗ trợ,
- broadcast,
- cleanup,
- và Cloud Functions.

Tài liệu README này được viết để bạn có thể mở code và lần ra logic từng phần nhanh hơn, thay vì phải đoán tác dụng của từng file.

---

# 12. Gợi ý tiếp theo

Nếu bạn muốn, mình có thể làm tiếp một bản nữa theo kiểu:
- viết **mục lục báo cáo hoàn chỉnh** cho cả web admin + app Android,
- hoặc chuyển toàn bộ phần này sang dạng **bảng và sơ đồ chuẩn để đưa vào Word**.
