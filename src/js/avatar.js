/**
 * avatar.js - Xử lý tải ảnh đại diện, crop vuông, nén ảnh nhẹ và sinh avatar mặc định
 */

/**
 * Xử lý file ảnh được chọn: Đọc, resize 200x200, crop vuông ở giữa và xuất Base64 JPEG
 * @param {File} file - File ảnh người dùng chọn
 * @returns {Promise<string>} Chuỗi Base64 Data URL
 */
export function processImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Vui lòng chọn một file ảnh hợp lệ'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const size = 200; // 200x200px là kích thước hoàn hảo, siêu nét và nhẹ (~12KB)
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');

          // Tính toán crop vuông ở giữa (center crop)
          const minDim = Math.min(img.width, img.height);
          const startX = (img.width - minDim) / 2;
          const startY = (img.height - minDim) / 2;

          ctx.drawImage(
            img,
            startX, startY, minDim, minDim, // Cắt hình vuông ở giữa
            0, 0, size, size                 // Vẽ vào canvas 200x200
          );

          // Xuất ảnh chất lượng 0.85
          const base64Url = canvas.toDataURL('image/jpeg', 0.85);
          resolve(base64Url);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Không thể tải file ảnh'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Không thể đọc file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Sinh Avatar SVG thể thao ngẫu nhiên hoặc theo tên & giới tính nếu thành viên chưa có ảnh
 */
export function generateDefaultAvatar(name, gender = 'male') {
  const cleanName = (name || 'Member').trim();
  const parts = cleanName.split(/\s+/);
  let initials = '';
  if (parts.length >= 2) {
    initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  } else {
    initials = cleanName.slice(0, 2).toUpperCase();
  }

  const isMale = gender === 'male';
  const bgGradient = isMale
    ? ['#0284c7', '#0369a1'] // Xanh dương thể thao nam
    : ['#ec4899', '#be185d']; // Hồng thể thao nữ

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <defs>
        <linearGradient id="grad_${initials}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${bgGradient[0]}" />
          <stop offset="100%" stop-color="${bgGradient[1]}" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#grad_${initials})" stroke="#ffffff" stroke-width="2" />
      <text x="50" y="58" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
        ${initials}
      </text>
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

/**
 * Trả về ảnh avatar hoàn chỉnh (Custom avatar hoặc Fallback SVG)
 */
export function getAvatarUrl(member) {
  if (member && member.avatar && member.avatar.trim() !== '') {
    return member.avatar;
  }
  return generateDefaultAvatar(member ? member.name : '', member ? member.gender : 'male');
}

/**
 * Render Avatar hoàn chỉnh kèm Khung Avatar Động (Giai đoạn 3)
 * @param {Object} member - Thông tin thành viên
 * @param {Object} options - { size: 'sm'|'md'|'lg'|'xl', className: string, imgStyle: string, wrapStyle: string }
 * @returns {string} HTML markup của Avatar kèm khung
 */
export function renderAvatarHtml(member, options = {}) {
  const size = options.size || 'md';
  const extraClass = options.className || '';
  const imgStyle = options.imgStyle || '';
  const wrapStyle = options.wrapStyle || '';
  const avatarUrl = getAvatarUrl(member);
  const activeFrame = member?.activeFrame || '';

  const frameClass = activeFrame ? `avatar-frame-wrap frame-${activeFrame.replace(/^frame_/, '')}` : '';

  return `
    <div class="avatar-container avatar-${size} ${frameClass} ${extraClass}" style="${wrapStyle}">
      <img src="${avatarUrl}" class="avatar-img" style="${imgStyle}" alt="${member ? member.name : 'Avatar'}" loading="lazy">
      ${activeFrame ? `<span class="frame-deco-badge" data-frame="${activeFrame}"></span>` : ''}
    </div>
  `;
}

