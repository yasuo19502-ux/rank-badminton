# Triển khai sửa xu ngày 23/10/2026

Ứng dụng yêu cầu bản nâng cấp cơ sở dữ liệu trong
`supabase/migrations/20261023_atomic_wallet.sql`. Đây là migration bổ sung:
nó giữ số dư hiện tại, không cộng bù hoặc tính lại lịch sử cũ.

1. Sao lưu số dư, Elo, trận, vé cược, giao dịch và inventory hiện tại vào nơi riêng tư.
2. Chạy migration trong SQL Editor của đúng dự án `sfdtqtdjxnkkgjimnliz`.
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
