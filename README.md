# WEB ADMIN - TIM TRO 24/7

Tài liệu này được viết lại theo kiểu **dễ đọc, dễ nắm logic, và dễ debug** giống cách mình đã viết cho phần app Android.

Mục tiêu của tài liệu này là giúp bạn hiểu rõ:
- web admin này dùng để làm gì
- từng màn hình trên web làm nhiệm vụ gì
- dữ liệu đi từ web tới Firestore như thế nào
- các hàm quan trọng trong `public/app.js` đang xử lý gì
- Cloud Functions hỗ trợ phần nào
- web admin liên quan thế nào với app mobile

---

# 1. Tổng quan hệ thống web admin

Web admin là bảng điều khiển dành cho quản trị viên của hệ thống `TIM TRO 24/7`.

Nếu app Android là nơi người dùng thao tác trực tiếp, thì web admin là nơi quản trị viên:
- kiểm tra dữ liệu
- duyệt bài đăng
- duyệt hồ sơ xác minh CCCD
- quản lý người dùng
- xử lý thanh toán nâng cấp
- xem thống kê
- gửi thông báo hàng loạt
- can thiệp khi có dữ liệu sai hoặc spam

Nói dễ hiểu hơn: web admin là “phòng điều khiển” của toàn bộ hệ thống.

---

# 2. Công nghệ sử dụng

## 2.1 HTML / CSS / JavaScript
Web admin được viết theo kiểu web tĩnh kết hợp JavaScript logic.

### HTML
Dùng để xây cấu trúc giao diện:
- sidebar
- topbar
- dashboard cards
- bảng dữ liệu
- modal
- form lọc
- nút thao tác

### CSS
Dùng để tạo giao diện đẹp, rõ ràng và hiện đại:
- bố cục 2 cột
- sidebar trái
- nội dung chính bên phải
- card, bảng, badge, button
- hiệu ứng hover
- dark/light theme nếu có

### JavaScript
Dùng để xử lý toàn bộ logic web:
- đăng nhập admin
- đọc Firestore
- duyệt / từ chối bài
- xóa user
- lọc dữ liệu
- xuất Excel
- vẽ biểu đồ
- mở modal
- gọi Cloud Functions

---

## 2.2 Firebase
Web admin dùng chung backend Firebase với app Android.

Các phần Firebase quan trọng:
- **Authentication**: đăng nhập admin
- **Firestore**: lưu và đọc dữ liệu hệ thống
- **Storage**: ảnh CCCD, ảnh bài đăng, avatar
- **Cloud Functions**: xử lý nghiệp vụ tự động

---

## 2.3 Chart.js
Dùng để vẽ biểu đồ trong dashboard.

Ví dụ:
- số lượng bài đăng theo tháng
- phân loại người dùng
- thống kê trạng thái dữ liệu

---

## 2.4 Font Awesome
Dùng để hiển thị icon trong menu, nút và các thành phần giao diện.

---

## 2.5 Be Vietnam Pro
Font chữ chính của admin panel.

Font này giúp giao diện:
- hiện đại
- dễ đọc
- gọn gàng
- hợp với dashboard quản trị

---

# 3. Cấu trúc thư mục web admin

```text
Admin_TimTro_New/
├── public/
│   ├── index.html
│   ├── app.js
│   ├── ultra.css
│   ├── ultra.js
│   └── ...
├── phamtriendat_doantotnghiep/
│   ├── index.js
│   └── package.json
├── firestore.rules
├── storage.rules
├── firebase.json
└── README.md
```

## 3.1 `public/index.html`
Là khung giao diện chính của admin panel.

Trong file này có:
- sidebar
- topbar
- dashboard
- bảng bài đăng
- bảng người dùng
- bảng xác minh
- bảng thanh toán
- bảng lịch hẹn
- bảng hỗ trợ
- modal thao tác

## 3.2 `public/app.js`
Đây là file quan trọng nhất của web admin.

Nó chứa gần như toàn bộ logic:
- load dữ liệu
- render UI
- xử lý nút bấm
- lọc dữ liệu
- xóa dữ liệu
- duyệt dữ liệu
- mở modal
- xuất file Excel
- gửi thông báo
- gọi Cloud Functions

## 3.3 `public/ultra.css`
Chứa style riêng của giao diện.

## 3.4 `public/ultra.js`
Chứa logic UI phụ, ví dụ theme hoặc một số thao tác hỗ trợ.

## 3.5 `phamtriendat_doantotnghiep/index.js`
Đây là file Cloud Functions.

Nó chạy phía server và làm các việc tự động như:
- OCR CCCD
- xử lý thanh toán
- xóa dữ liệu user
- bật/tắt user bị khóa
- dọn dữ liệu cũ
- gửi thông báo đẩy

---

# 4. Web admin dùng để làm gì?

Web admin không phải là giao diện cho người dùng thường.
Nó dành riêng cho quản trị viên.

Quản trị viên cần web admin để:
- kiểm soát nội dung hệ thống
- xử lý các bài đăng chưa duyệt
- kiểm tra người dùng thật / giả
- xử lý người dùng vi phạm
- xử lý giao dịch nâng cấp
- giám sát hoạt động toàn hệ thống

Nếu không có web admin, việc điều hành hệ thống sẽ rất khó khăn và gần như không thể kiểm soát thủ công.

---

# 5. Cách web admin hoạt động tổng thể

Luồng chung của web admin thường là:

```text
Admin đăng nhập
-> Web kiểm tra role admin
-> Tải dữ liệu từ Firestore
-> Hiển thị dashboard / bảng dữ liệu
-> Admin bấm thao tác
-> Web ghi ngược dữ liệu vào Firestore hoặc gọi Cloud Function
-> Firebase / Cloud Functions xử lý tiếp
-> UI được cập nhật lại
```

### Ý nghĩa của mô hình này
Web không tự lưu dữ liệu kiểu local-only.
Nó là một lớp điều khiển trực tiếp vào backend Firebase.

---

# 6. Các màn hình chính của web admin

Dựa trên `public/index.html`, web admin thường có các trang / khu vực chính sau.

## 6.1 Dashboard
Dashboard là trang tổng quan đầu tiên.

### Nó hiển thị gì?
- số bài đăng chờ duyệt
- số người dùng
- số hồ sơ xác minh
- biểu đồ bài đăng theo thời gian
- biểu đồ cơ cấu người dùng
- danh sách bài đăng gần nhất
- danh sách người dùng gần nhất

### Mục đích
Giúp admin nhìn nhanh tình hình chung của hệ thống mà không cần vào từng trang nhỏ.

---

## 6.2 Quản lý bài đăng
Đây là khu vực để admin xem và xử lý các bài phòng trọ.

### Admin có thể làm gì?
- xem danh sách bài
- lọc theo trạng thái
- xem chi tiết
- duyệt bài
- từ chối bài
- xóa bài
- lọc theo ngày
- xuất Excel

### Mục đích
Đảm bảo bài đăng hiển thị đúng, sạch và hợp lệ trước khi người dùng nhìn thấy.

---

## 6.3 Quản lý xác minh CCCD
Đây là nơi admin xem các yêu cầu xác minh.

### Admin có thể làm gì?
- mở ảnh mặt trước CCCD
- mở ảnh mặt sau CCCD
- xem thông tin người nộp
- duyệt xác minh
- từ chối xác minh

### Mục đích
Đảm bảo chỉ chủ trọ thật mới được mở quyền cần thiết.

---

## 6.4 Quản lý người dùng
Đây là nơi admin quản trị toàn bộ tài khoản người dùng.

### Admin có thể làm gì?
- xem danh sách user
- lọc user thường / đã xác minh / admin
- xem chi tiết tài khoản
- khóa tài khoản
- mở khóa tài khoản
- xóa tài khoản
- xuất Excel

### Mục đích
Kiểm soát người dùng vi phạm, tài khoản rác, tài khoản spam và tài khoản bị khóa.

---

## 6.5 Quản lý lịch hẹn
Admin có thể xem các lịch hẹn xem phòng.

### Mục đích
- theo dõi lịch sử đặt lịch
- kiểm tra trạng thái
- hỗ trợ xử lý khi có tranh chấp

---

## 6.6 Quản lý thanh toán
Đây là nơi theo dõi các yêu cầu thanh toán như:
- nâng cấp slot
- đẩy bài nổi bật
- các request thanh toán khác

### Mục đích
Đảm bảo giao dịch được đối soát đúng và trạng thái được cập nhật chính xác.

---

## 6.7 Quản lý hỗ trợ
Admin có thể xem các ticket hỗ trợ từ người dùng.

### Mục đích
- trả lời câu hỏi
- xử lý lỗi
- hỗ trợ người dùng đang bị kẹt thao tác

---

# 7. Giải thích từng hàm quan trọng trong `public/app.js`

Phần này là phần quan trọng nhất của README vì nó cho bạn hiểu web admin đang xử lý gì.

---

## 7.1 Các hàm khởi tạo và UI chung

### `stopAllListeners()`
Hàm này dùng để dừng các listener realtime đang hoạt động.

### Ý nghĩa
Khi chuyển sang trang khác hoặc tải lại dữ liệu, nếu listener cũ không tắt, web có thể:
- load trùng dữ liệu
- tăng chi phí đọc Firestore
- gây chậm

---

### `hideEntrySplash()`
Ẩn màn hình splash ban đầu của admin.

### Mục đích
Cho giao diện chính hiện ra sau khi load xong.

---

### `showEntrySplash(name = 'Administrator')`
Hiển thị splash hoặc màn hình chào trong lúc app đang load.

### Mục đích
Tạo cảm giác giao diện có trạng thái chờ, không bị trắng màn hình.

---

### `showToast(type, title, message, duration = 3000)`
Hiển thị thông báo nhỏ dạng toast.

### Dùng khi nào?
- xóa xong
- duyệt xong
- có lỗi
- cần báo thành công

### Ý nghĩa
Đây là cách web phản hồi nhanh cho admin mà không cần mở popup to.

---

### `showConfirm(title, message, type = 'warn')`
Hiện hộp thoại xác nhận trước khi làm thao tác nguy hiểm.

### Ví dụ dùng
- xóa user
- xóa bài đăng
- từ chối xác minh

### Ý nghĩa
Tránh bấm nhầm gây mất dữ liệu.

---

### `showPrompt(title, message, placeholder = '')`
Hiện hộp thoại nhập dữ liệu.

### Dùng khi nào?
- cần nhập lý do
- cần nhập nội dung
- cần sửa nhanh một giá trị nào đó

---

### `showModal(html)` và `closeModal()`
Dùng để mở và đóng modal chi tiết.

### Tại sao modal quan trọng?
Vì admin thường cần xem chi tiết mà không phải chuyển sang trang mới.

---

### `safeUrl(value)`
Làm sạch URL trước khi đưa vào giao diện.

### Ý nghĩa
Tránh lỗi hoặc URL không hợp lệ khi mở ảnh.

---

### `safeForJsGlobal(value)`
Dùng để đưa giá trị an toàn vào chuỗi JavaScript trong HTML inline.

### Mục đích
Giảm lỗi khi nhúng URL hoặc text vào `onclick`.

---

## 7.2 Hàm điều hướng và menu

### `navigateTo(page)`
Chuyển giao diện admin sang một trang khác.

### Ví dụ
- từ dashboard sang users
- từ users sang verifications
- từ posts sang payments

### Ý nghĩa
Hàm này điều khiển việc hiển thị page nào đang active.

---

### `bindTabs(groupId, loadFn)`
Gắn sự kiện cho nhóm tab.

### Mục đích
Khi bấm tab, web biết phải load dữ liệu nào.

---

## 7.3 Hàm dashboard

### `loadDashboard()`
Đây là một trong những hàm quan trọng nhất.

### Nó làm gì?
- tải các bài chờ duyệt
- tải người dùng mới nhất
- lấy toàn bộ bài và user để thống kê
- render biểu đồ dashboard
- cập nhật danh sách recent posts/users

### Logic xử lý
Hàm này thường gọi song song nhiều truy vấn Firestore bằng `Promise.all`, để tải nhanh hơn.

### Tại sao phải có `dashboardAllPostDocs` và `dashboardAllUserDocs`?
Để cache dữ liệu và phục vụ việc lọc biểu đồ theo ngày mà không phải query lại tất cả liên tục.

---

### `filterPostDocsByDate(postDocs, dateFromValue, dateToValue)`
Lọc bài đăng theo khoảng ngày.

### Mục đích
Admin chọn từ ngày nào đến ngày nào rồi xem biểu đồ hoặc thống kê.

---

### `window.updatePostChartByDate = function()`
Đây là hàm được gắn global để nút lọc chart gọi trực tiếp.

### Tại sao dùng `window.`?
Vì nút HTML inline cần gọi được hàm global.

### Logic
- đọc giá trị ngày từ input
- kiểm tra ngày hợp lệ
- lọc dữ liệu bài đăng
- vẽ lại chart

---

### `renderDashboardCharts(postDocs, userDocs)`
Vẽ các biểu đồ dashboard.

### Nó làm gì?
- vẽ line chart bài đăng theo 6 tháng
- vẽ doughnut chart cơ cấu người dùng

### Ý nghĩa
Giúp admin nắm nhanh xu hướng của hệ thống.

---

## 7.4 Hàm quản lý bài đăng

### `loadPosts(filter)`
Tải danh sách bài đăng từ Firestore.

### Logic
- query `rooms`
- lọc theo trạng thái nếu cần
- lưu vào state
- render bảng

### `getFilteredPostsDocs()`
Lấy danh sách bài đã lọc theo:
- trạng thái
- từ khóa
- thời gian
- khu vực

### `renderPosts()`
Render bảng bài đăng ra giao diện.

### Tại sao tách ra thành `loadPosts()` và `renderPosts()`?
Để tách việc lấy dữ liệu và việc hiển thị dữ liệu.
Điều này giúp code dễ bảo trì hơn.

---

### `viewPost(docId)`
Mở modal chi tiết bài đăng.

### Dùng để xem gì?
- tiêu đề
- mô tả
- địa chỉ
- ảnh
- người đăng
- trạng thái
- các field liên quan

---

### `approvePost(docId, userId, title)`
Duyệt bài.

### Logic
- đổi trạng thái bài thành approved
- ghi cập nhật vào Firestore
- có thể gửi thông báo cho chủ bài

---

### `rejectPost(docId, userId, title)`
Từ chối bài.

### Logic
- đổi trạng thái sang rejected
- lưu lý do nếu có
- cập nhật giao diện

---

### `deletePostRecordCompletely(docId)`
Xóa bài đăng và dọn dữ liệu liên quan.

### Tại sao cần xóa dọn?
Vì bài đăng có thể liên quan đến:
- ảnh
- thông báo
- lịch hẹn
- bài nổi bật
- dữ liệu khác trong hệ thống

---

### `deleteSelectedPosts()`
Xóa nhiều bài cùng lúc.

### Ý nghĩa
Tiện cho admin khi cần dọn spam hoặc xóa hàng loạt.

---

## 7.5 Hàm quản lý người dùng

### `loadUsers(filter)`
Tải danh sách người dùng.

### Logic
- fetch toàn bộ user
- lọc client-side theo tab
- sắp xếp
- render bảng

### Tại sao tải rồi lọc ở client?
Vì admin cần nhiều kiểu lọc khác nhau và dữ liệu user thường không quá khổng lồ để không thể xử lý trên client.

---

### `getFilteredUsersDocs()`
Lọc user theo:
- tab hiện tại
- từ khóa tìm kiếm
- khoảng ngày

---

### `renderUsers()`
Render bảng người dùng.

### Hiển thị gì?
- tên
- email
- vai trò
- trạng thái xác minh
- tình trạng khóa
- ngày tham gia
- nút xem chi tiết
- nút khóa / mở khóa

---

### `viewUser(docId)`
Xem chi tiết user.

### Nó làm gì?
- lấy document `users/{uid}`
- lấy luôn thông tin xác minh nếu có
- hiển thị trong modal

---

### `toggleLockUser(uid, currentlyLocked)`
Khóa hoặc mở khóa user.

### Mục đích
- xử lý user spam
- xử lý user vi phạm
- tạm thời ngăn user hoạt động

---

### `processLockUser(uid)`
Xử lý logic khóa user thực tế.

### Thường sẽ làm gì?
- cập nhật trạng thái lock
- set thời gian khóa
- gửi thông báo
- cập nhật lại giao diện

---

### `deleteUser(docId, options = {})`
Đây là một hàm rất quan trọng và khá dài.

### Nó làm gì?
1. xác nhận trước khi xóa
2. gọi Cloud Function để xóa user khỏi Authentication
3. xóa document user trong Firestore
4. xóa verifications liên quan
5. xóa rooms của user
6. xóa avatar / ảnh xác minh
7. xóa appointments / notifications / saved data liên quan
8. xóa bookedSlots liên quan
9. trả kết quả cho UI

### Ý nghĩa
Đây không chỉ là “xóa user”, mà là dọn toàn bộ dữ liệu liên quan để tránh rác dữ liệu.

---

### `deleteSelectedUsers()`
Xóa nhiều user cùng lúc.

### Mục đích
Tối ưu thời gian khi cần dọn nhóm tài khoản vi phạm.

---

### `exportUsersToExcel()`
Xuất danh sách user ra file Excel.

### Dùng khi nào?
- báo cáo
- thống kê
- lưu offline
- xử lý nội bộ

---

## 7.6 Hàm quản lý lịch hẹn

### `loadAppointments(filter = 'all')`
Tải danh sách lịch hẹn.

### `renderAppt()`
Hiển thị bảng lịch hẹn.

### `deleteSelectedAppointments()`
Xóa nhiều lịch hẹn cùng lúc.

### Ý nghĩa
Giúp admin dọn các lịch lỗi, trùng hoặc không còn hợp lệ.

---

## 7.7 Hàm quản lý xác minh CCCD

### `loadVerifications()`
Tải danh sách yêu cầu xác minh.

### `viewVerification(docId)`
Xem chi tiết một yêu cầu xác minh.

### `approveVerification(docId, userId)`
Duyệt hồ sơ xác minh.

### `rejectVerification(docId, userId)`
Từ chối hồ sơ xác minh.

### Logic chung
- đọc ảnh mặt trước / mặt sau
- xem số CCCD
- xem thông tin người nộp
- cập nhật trạng thái xác minh
- có thể kích hoạt các quyền liên quan sau khi duyệt

---

## 7.8 Hàm quản lý thanh toán

### `loadPayments(filter)`
Tải danh sách thanh toán.

### `renderPayments()`
Hiển thị bảng thanh toán.

### `deletePaymentRecord(id, type)`
Xóa một bản ghi thanh toán.

### `deleteSelectedPayments()`
Xóa hàng loạt thanh toán.

### Lý do phần này quan trọng
Thanh toán là dữ liệu tài chính hoặc bán tài nguyên (slot / featured). Vì vậy admin phải có công cụ kiểm tra, duyệt và xóa chính xác.

---

## 7.9 Hàm hỗ trợ / ticket

### `loadSupportTickets(filter = 'new')`
Tải danh sách ticket hỗ trợ.

### `openSupportTicket(ticketId)`
Mở ticket chi tiết.

### `sendSupportReply(ticketId)`
Gửi phản hồi cho người dùng.

### `updateSupportStatus(ticketId, status)`
Cập nhật trạng thái ticket.

### Ý nghĩa
Giúp admin chăm sóc người dùng và xử lý vấn đề nhanh hơn.

---

## 7.10 Hàm lọc theo ngày

### `isInDateRange(value, filter)`
Kiểm tra một dữ liệu có nằm trong khoảng ngày được lọc không.

### `applyDateFilter(page)`
Áp dụng filter ngày cho từng khu vực.

### `clearDateFilter(page)`
Xóa bộ lọc ngày.

### Ý nghĩa
Admin có thể thống kê theo khoảng thời gian một cách trực quan.

---

## 7.11 Hàm gửi broadcast

### `sendBroadcast()`
Gửi thông báo hàng loạt cho người dùng.

### Dùng khi nào?
- thông báo bảo trì
- thông báo cập nhật
- thông báo hệ thống
- thông báo khuyến mãi

---

# 8. Luồng dữ liệu từ web admin đến Firestore đến app mobile

Phần này là phần bạn yêu cầu rất quan trọng.

## 8.1 Luồng khi admin duyệt bài đăng

```text
Admin mở trang bài đăng
-> loadPosts() đọc Firestore rooms
-> renderPosts() hiển thị lên bảng
-> admin bấm Duyệt
-> approvePost(docId, userId, title)
-> Firestore cập nhật status = approved
-> nếu có thông báo thì gửi thêm notification
-> app mobile khi load lại sẽ thấy bài đã duyệt
```

### Ý nghĩa
Admin là người thay đổi trạng thái, còn app mobile là nơi hiển thị lại trạng thái đó.

---

## 8.2 Luồng khi admin duyệt xác minh CCCD

```text
Admin mở trang xác minh
-> loadVerifications() đọc dữ liệu verifications
-> render bảng yêu cầu
-> admin mở ảnh CCCD
-> approveVerification(docId, userId)
-> Firestore cập nhật trạng thái verified
-> app mobile đọc lại userInfo
-> user thấy trạng thái đã xác minh
```

### Ý nghĩa
Web admin đóng vai trò xác nhận danh tính, app mobile sẽ phản chiếu trạng thái mới.

---

## 8.3 Luồng khi admin khóa user

```text
Admin vào trang users
-> loadUsers() đọc users
-> renderUsers() hiển thị trạng thái
-> admin bấm khóa
-> toggleLockUser(uid, false)
-> Firestore cập nhật isLocked = true
-> Cloud Function hoặc logic kèm theo có thể xử lý thêm
-> app mobile khi load lại sẽ thấy user bị khóa
```

### Ý nghĩa
Đây là cơ chế quản trị vi phạm.

---

## 8.4 Luồng khi admin xóa user

```text
Admin bấm xóa user
-> deleteUser(uid)
-> gọi Cloud Function deleteUserAccount
-> xóa Auth user
-> xóa Firestore user doc
-> xóa rooms, verifications, appointments, notifications, storage files
-> app mobile không còn thấy tài khoản này
```

### Ý nghĩa
Xóa user là xóa theo chuỗi dữ liệu liên quan, không chỉ xóa một document đơn lẻ.

---

## 8.5 Luồng khi app mobile ghi dữ liệu thì web admin nhìn thấy gì?

Ví dụ app mobile tạo bài đăng:

```text
Người dùng bấm đăng bài trên app
-> app ghi rooms/{roomId}
-> admin web load lại rooms
-> bài đăng mới xuất hiện trong bảng
-> admin có thể duyệt bài
```

### Ý nghĩa
Web và app không tách biệt dữ liệu. Chúng cùng nhìn vào một Firestore chung.

---

# 9. Cloud Functions quan trọng trong web backend

File chính:
- `phamtriendat_doantotnghiep/index.js`

## 9.1 `autoReviewVerificationByCloudVision`
Tự động OCR / chấm thông tin CCCD.

### Mục đích
Giảm tải cho admin khi hồ sơ nhiều.

## 9.2 `autoUnlockUsers`
Tự động mở khóa user khi hết thời gian khóa.

## 9.3 `dailyDataCleanup`
Dọn dữ liệu cũ theo lịch.

## 9.4 `deleteUserAccount`
Xóa user khỏi Firebase Authentication qua HTTPS function.

### Vì sao web gọi function này?
Vì web không tự xóa Auth trực tiếp được an toàn như server-side function.

## 9.5 `sendPushNotification`
Gửi push notification.

## 9.6 `processPendingSlotUpgradePayments`
Đối soát thanh toán nâng cấp slot.

## 9.7 `processPendingFeaturedUpgradePayments`
Đối soát thanh toán nâng cấp bài nổi bật.

## 9.8 `autoDisableExpiredFeaturedRooms`
Tự động tắt bài nổi bật đã hết hạn.

---

# 10. Giải thích từng phần giao diện admin

## 10.1 Sidebar
Sidebar là menu điều hướng chính.

Nó thường chứa:
- Dashboard
- Bài đăng
- Xác minh
- User
- Thanh toán
- Hỗ trợ
- Cài đặt

### Ý nghĩa
Giúp admin chuyển trang nhanh mà không phải load lại toàn bộ web.

---

## 10.2 Topbar
Topbar thường chứa:
- tiêu đề trang
- breadcrumb
- ngày hiện tại
- icon thao tác nhanh

### Ý nghĩa
Cho admin biết mình đang đứng ở đâu trong hệ thống.

---

## 10.3 Dashboard cards
Các card thống kê hiển thị số liệu nổi bật.

Ví dụ:
- tổng bài đăng
- bài chờ duyệt
- số user
- số xác minh chờ duyệt

### Ý nghĩa
Đây là phần nhìn nhanh để admin biết hệ thống đang “khỏe” hay có vấn đề.

---

## 10.4 Bảng dữ liệu
Mỗi trang nghiệp vụ thường dùng bảng.

### Bảng sẽ hiển thị gì?
- thông tin chính
- trạng thái
- nút hành động
- thời gian tạo

### Tại sao dùng bảng?
Vì dữ liệu quản trị thường nhiều và cần xem theo hàng cột rõ ràng.

---

## 10.5 Modal chi tiết
Admin không phải lúc nào cũng chuyển trang riêng để xem chi tiết. Nhiều chỗ sẽ mở modal.

### Mục đích
- xem nhanh
- tiết kiệm thời gian
- thao tác gọn

---

# 11. Những logic rất đáng chú ý trong app.js

## 11.1 Cache dữ liệu dashboard
Trong dashboard, web cache toàn bộ bài và user để phục vụ biểu đồ.

### Lý do
Nếu mỗi lần lọc biểu đồ lại query Firestore từ đầu thì sẽ chậm và tốn reads.

## 11.2 Client-side filtering
Rất nhiều tab tải dữ liệu rồi lọc ngay trên browser.

### Ưu điểm
- nhanh hơn cho UI
- ít phải query lặp lại
- dễ áp dụng nhiều bộ lọc

## 11.3 Xử lý xóa nhiều bản ghi
Các hàm xóa hàng loạt thường dùng `Set`, `Map`, batch delete và chia chunk 500 item.

### Tại sao phải chia chunk?
Firestore batch có giới hạn số lệnh trong một batch. Nếu không chia chunk có thể lỗi.

## 11.4 Dọn dữ liệu liên quan
Khi xóa user hoặc bài đăng, web không chỉ xóa document chính mà còn xóa:
- storage files
- notifications
- appointments
- verifications
- booked slots
- các collection phụ khác

### Ý nghĩa
Giúp hệ thống sạch, tránh rác dữ liệu.

---

# 12. Luồng dữ liệu từ mobile lên web admin

## Ví dụ 1: user đăng bài trên app

```text
Android app
-> tạo document rooms
-> Firebase lưu bài
-> admin web load lại rooms
-> bài hiện trong danh sách chờ duyệt
```

## Ví dụ 2: user gửi xác minh CCCD trên app

```text
Android app
-> upload ảnh lên Storage
-> tạo document verifications
-> admin web load dữ liệu
-> admin duyệt / từ chối
```


---


# 13. Lỗi dễ gặp trong web admin và cách hiểu

## 13.1 Nút bấm không chạy
Có thể do:
- hàm chưa gắn vào `window`
- HTML gọi sai tên hàm
- file JS chưa load xong

## 13.2 Bảng dữ liệu trống
Có thể do:
- query sai collection
- trạng thái lọc không đúng
- Firestore chưa có dữ liệu
- rules chặn đọc

## 13.3 Xóa user nhưng dữ liệu còn sót
Do dữ liệu nằm ở nhiều nơi:
- users
- rooms
- appointments
- notifications
- verifications
- storage

Nếu chỉ xóa một chỗ thì vẫn còn rác.

## 13.4 Biểu đồ không refresh
Có thể do:
- chưa render lại chart
- chưa update cache
- filter ngày không hợp lệ

---

# 14. Vì sao README này quan trọng?

Vì web admin không phải chỉ là mấy cái bảng và nút.
Nó là phần điều hành toàn bộ hệ thống.

Nếu không hiểu:
- màn hình nào làm gì
- hàm nào xử lý gì
- dữ liệu đi ra sao
- web tác động thế nào đến app mobile

thì sau này sửa sẽ rất khó.

Tài liệu này giúp bạn có một bản đồ rõ ràng để đọc code.

---

# 15. Tóm tắt cực ngắn

Web admin của `TIM TRO 24/7` có 3 nhiệm vụ lớn:

1. **Quan sát**: xem dashboard, thống kê, danh sách dữ liệu
2. **Xử lý**: duyệt bài, duyệt xác minh, khóa user, xóa dữ liệu
3. **Đồng bộ**: ghi ngược kết quả về Firestore để app mobile nhìn thấy thay đổi

---

# 16. Kết luận

Nếu app Android là nơi người dùng thao tác thì web admin là nơi quản trị hệ thống.

Toàn bộ web admin của bạn được tổ chức theo hướng:
- giao diện rõ ràng trong `index.html`
- logic chính trong `app.js`
- style trong `ultra.css`
- xử lý tự động trong Cloud Functions

Nói gọn lại:
- **HTML** = bộ khung
- **CSS** = giao diện
- **JS** = logic điều khiển
- **Firebase** = nơi lưu dữ liệu thật
- **Cloud Functions** = nơi xử lý nghiệp vụ tự động

---

# 17. Tài liệu liên quan

- `README.md` ở app Android — mô tả toàn bộ app mobile

Nếu bạn muốn, mình có thể làm tiếp cho bạn một bản còn sâu hơn nữa theo kiểu:
- giải thích từng page trong `index.html`
- giải thích từng hàm trong `app.js` theo từng nhóm
- vẽ sơ đồ luồng dữ liệu giữa mobile, web và Firestore

