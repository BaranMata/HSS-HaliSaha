# HSS (Halı Saha Sosyal) - Backend Software Flow ⚙️

Bu proje, HSS mobil uygulamasının veri yönetimini, medya yüklemelerini ve harita (radar) API uç noktalarını sağlayan Node.js/Express.js tabanlı arka uç sunucusudur. Bulut veritabanı olarak Firebase (Firestore) kullanılmıştır.

## 🚀 Kurulum ve Çalıştırma

### Gereksinimler
- Node.js (v16 veya üzeri)
- Firebase Service Account Key

### Adımlar
1. Proje dizinine gidin ve gerekli paketleri indirin:
   ```bash
   npm install

   npm run dev
# veya
node index.js

📡 API Uç Noktaları (Özet)
POST /api/media/upload: Video yükleme ve Firestore'a kayıt.

GET /api/media/feed: Ana sayfa yetenek videoları (Reels) akışı.

POST /api/matches/create: Haritada (Radarda) yeni halı saha ilanı oluşturma.

GET /api/matches/nearby: Radardaki aktif ilanları getirme.

POST /api/media/like & comment: Sosyal etkileşim motorları.
