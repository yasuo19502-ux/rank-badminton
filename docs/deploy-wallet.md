# Triển khai sửa xu ngày 23/10/2026

Ứng dụng yêu cầu bản nâng cấp cơ sở dữ liệu trong
`supabase/migrations/20261023_atomic_wallet.sql`. Đây là migration bổ sung:
nó giữ số dư hiện tại, không cộng bù hoặc tính lại lịch sử cũ.

1. Sao lưu số dư, Elo, trận, vé cược, giao dịch và inventory hiện tại vào nơi riêng tư.
2. Chạy migration trong SQL Editor của đúng dự án `sfdtqtdjxnkkgjimnliz`.
   Sau đó chạy `supabase/migrations/20261024_safe_frame_gifts.sql` để việc tặng
   khung tự động chỉ cập nhật mỹ phẩm, không ghi hồ sơ/Elo cũ từ trình duyệt.
   Không chạy lại toàn bộ `supabase_schema.sql` cũ.
3. Kiểm tra `select public.club_wallet_version();` trả `2`; số dư và Elo
   của các thành viên không thay đổi sau migration.
4. Triển khai bản frontend tương ứng lên Vercel ngay sau migration. Trình duyệt
   dùng phiên bản cũ cần tải lại trang; các thao tác ghi xu/cược trực tiếp của
   phiên bản cũ sẽ bị từ chối để tránh tiếp tục làm sai dữ liệu.
5. Kiểm tra production tải được bản mới, đồng bộ sân/ví, không có lỗi console.
   Không tạo cược hoặc trận giả trên dữ liệu CLB thật.

Kiểm thử: `npm test` bao gồm các hàm thật của frontend với API giả lập và
PostgreSQL chạy trong bộ nhớ qua PGlite. `npm run build` tạo bundle triển khai.

Các thao tác được máy chủ xử lý nguyên tử: chốt kết quả, Elo/thống kê, tiêu hao
khiên, thưởng ngày/trận, quyết toán toàn bộ vé thuộc đúng trận, hoàn tác và mua đồ.
Vé được gắn ID từ lúc xếp trận. Thay đổi đội hình sẽ hoàn vé cũ; cập nhật từ sân
cũ bị từ chối. Giao dịch và ví chỉ thay đổi trong cùng transaction và có khóa
chống xử lý trùng khi gửi lại yêu cầu.

Phục hồi xu cũ là công việc riêng: cần chốt các vé nghi gắn nhầm và giao dịch
thủ công trước khi cộng bù. Migration không sửa kết quả/số dư lịch sử đã đối soát.

## Nâng cấp bảo toàn dữ liệu: phiên bản 3

Sau hai migration trên, chạy `20261024_guarded_operations.sql`, rồi triển khai
frontend cùng phiên bản ngay sau đó. Không chạy lại migration v2 sau v3, vì v2
chứa các entry point cũ. Yêu cầu Node 20.19+ hoặc 22.12+ cho công cụ build mới.

Migration v3 chụp số lượng và dấu kiểm của cả chín bảng nghiệp vụ bên trong
transaction. Nếu bất kỳ bản ghi hiện có nào thay đổi, toàn bộ nâng cấp bị hủy.
Không tính lại Elo, xu, thống kê hoặc lịch sử; không tặng lại khung hiện có.
Sao lưu riêng tư trước khi nâng cấp và không commit/upload bản sao lưu.

Mọi người đăng nhập lại một lần bằng PIN hiện tại. PIN không còn được gửi xuống
trình duyệt. Tài khoản chưa có PIN cần quản trị viên thiết lập; quản trị viên
được nhận diện bằng ID cố định, không dựa vào tên. Hồ sơ chỉ cập nhật trường
được yêu cầu và từ chối phiên bản cũ. Máy chủ tính Elo, kiểm tra điểm đang lưu,
quyết toán xu/khiên/khách/điểm danh trong cùng lần lưu. Khiên vẫn giảm 50% điểm
trừ như quy tắc hiện hành; không đổi quy tắc kinh doanh.

Xuất sao lưu quản trị bao gồm chín bảng, không gồm PIN/phiên đăng nhập. Nhập
sao lưu vào cloud bị khóa để tránh ghi đè một phần; khôi phục cloud phải được
đối soát và triển khai riêng. Nút dọn bộ nhớ chỉ xóa cache trên thiết bị.

`npm test` kiểm tra cả PostgreSQL thật chạy trong bộ nhớ và giao diện giả lập.
Có thể kiểm tra bảo toàn toàn bộ backup riêng tư, không truy cập mạng, bằng:
`CLUB_PRESERVATION_BACKUP=/absolute/private/backup.json node test_guarded_operations.js`.
Không thử tạo trận, vé cược hoặc nhận hàng giả trên app thật.
