const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log("HSS Veritabanı bağlantısı başarılı!");

// Express uygulamasını başlat
const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

// --- API UÇ NOKTALARI BAŞLIYOR ---

// 1. Kullanıcı Kayıt (Register) Uç Noktası
app.post('/api/auth/register', async (req, res) => {
    try {
        const { uid, username, position } = req.body;

        if (!uid || !username) {
            return res.status(400).send({ error: "UID ve Username zorunludur!" });
        }

        await db.collection('USERS').doc(uid).set({
            UserID: uid,
            Username: username,
            Skill_Rating: 0,
            Position: position || "Belirtilmedi"
        });

        res.status(201).send({ message: "Kullanıcı başarıyla oluşturuldu!", uid: uid });

    } catch (error) {
        console.error("Kayıt Hatası:", error);
        res.status(500).send({ error: "Kayıt işlemi sırasında bir hata oluştu." });
    }
});

// 2. İlan Oluşturma (Create Match) Uç Noktası (SDD 5.2)
app.post('/api/matches/create', async (req, res) => {
    try {
        const { organizerId, latitude, longitude, requiredPosition } = req.body;

        // Gelen verilerin eksik olup olmadığını kontrol et
        if (!organizerId || !latitude || !longitude || !requiredPosition) {
            return res.status(400).send({ error: "Eksik bilgi gönderdiniz! Lütfen tüm alanları doldurun." });
        }

        // Firestore 'MATCH' koleksiyonuna yeni bir doküman oluştur (Auto-ID ile)
        const newMatchRef = db.collection('MATCH').doc();
        await newMatchRef.set({
            MatchID: newMatchRef.id,
            OrganizerID: organizerId,
            Latitude: latitude,
            Longitude: longitude,
            Required_Position: requiredPosition,
            Status: "Aktif",
            CreatedAt: admin.firestore.FieldValue.serverTimestamp() // Oluşturulma zamanı
        });

        res.status(201).send({ message: "Maç ilanı başarıyla oluşturuldu!", matchId: newMatchRef.id });

    } catch (error) {
        console.error("İlan Oluşturma Hatası:", error);
        res.status(500).send({ error: "İlan oluşturulurken sunucuda bir hata meydana geldi." });
    }
});

// 3. İlanları Getir (Get Matches) Uç Noktası (SDD 5.2)
app.get('/api/matches/nearby', async (req, res) => {
    try {
        // Haritada gösterilmek üzere 'MATCH' koleksiyonundaki tüm aktif ilanları çek
        const snapshot = await db.collection('MATCH').get();
        const matches = [];

        snapshot.forEach(doc => {
            matches.push(doc.data());
        });

        // İstemciye (Mobil uygulamaya) JSON dizisi olarak gönder
        res.status(200).send({ matches: matches });
    } catch (error) {
        console.error("İlanları Getirme Hatası:", error);
        res.status(500).send({ error: "İlanlar getirilirken bir hata oluştu." });
    }
});

// 4. Maça Başvuru Yap (Apply to Match) Uç Noktası
app.post('/api/applications/apply', async (req, res) => {
  try {
    const { matchId, applicantId } = req.body;

    // Eksik veri kontrolü
    if (!matchId || !applicantId) {
        return res.status(400).send({ error: "Maç ID ve Başvuran ID zorunludur!" });
    }

    // APPLICATION koleksiyonuna yeni başvuru ekle
    const newApplicationRef = db.collection('APPLICATION').doc();
    await newApplicationRef.set({
      ApplicationID: newApplicationRef.id,
      MatchID: matchId,
      ApplicantID: applicantId,
      Status: "Beklemede", // İlan sahibi onaylayana kadar beklemede kalır
      AppliedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(201).send({ 
      message: "Başvurunuz başarıyla alındı ve ilan sahibine iletildi!", 
      applicationId: newApplicationRef.id 
    });

  } catch (error) {
    console.error("Başvuru Hatası:", error);
    res.status(500).send({ error: "Başvuru sırasında sunucuda bir hata oluştu." });
  }
});

// --- SİSTEMİN GERİ KALAN API'LERİ ---

// 5. Başvuruyu Yanıtla (İlan Sahibinin Onayı/Reddi)
app.post('/api/applications/respond', async (req, res) => {
  try {
    const { applicationId, status } = req.body; // status: "Onaylandı" veya "Reddedildi" olarak gelecek

    if (!applicationId || !status) {
        return res.status(400).send({ error: "Başvuru ID ve yeni durum (status) zorunludur!" });
    }

    // APPLICATION tablosundaki ilgili başvurunun durumunu güncelle
    await db.collection('APPLICATION').doc(applicationId).update({
      Status: status,
      UpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).send({ message: `Başvuru durumu başarıyla '${status}' olarak güncellendi!` });

  } catch (error) {
    console.error("Başvuru Yanıtlama Hatası:", error);
    res.status(500).send({ error: "İşlem sırasında sunucuda bir hata oluştu." });
  }
});

// 6. Oyuncu Puanlama (Maç Sonu Değerlendirme Sistemi)
app.post('/api/users/rate', async (req, res) => {
  try {
    const { targetUserId, rating } = req.body; // rating: 1-5 arası bir sayı

    if (!targetUserId || rating === undefined) {
        return res.status(400).send({ error: "Puanlanacak kullanıcı ID ve Puan zorunludur!" });
    }

    // Kullanıcının yetenek puanını (Skill_Rating) Firestore'un increment özelliği ile artır
    await db.collection('USERS').doc(targetUserId).update({
      Skill_Rating: admin.firestore.FieldValue.increment(rating)
    });

    res.status(200).send({ message: "Kullanıcı başarıyla puanlandı!" });

  } catch (error) {
    console.error("Puanlama Hatası:", error);
    res.status(500).send({ error: "Puanlama sırasında hata oluştu. Kullanıcı mevcut olmayabilir." });
  }
});

// 7. Reels / Medya Akışını Getir (Ana Ekran Sosyal Medya Algoritması)
app.get('/api/media/feed', async (req, res) => {
  try {
    // MEDIA koleksiyonundaki videoları yüklenme tarihine göre en yeniden eskiye doğru sırala
    // limit(10) ile tek seferde sadece 10 video çekerek internet tasarrufu sağla
    const snapshot = await db.collection('MEDIA').orderBy('UploadedAt', 'desc').limit(10).get();
    const feed = [];

    snapshot.forEach(doc => {
      feed.push(doc.data());
    });

    res.status(200).send({ feed: feed });
  } catch (error) {
    console.error("Medya Akışı Hatası:", error);
    res.status(500).send({ error: "Reels akışı getirilirken bir hata oluştu." });
  }
});

// --- API UÇ NOKTALARI TAMAMLANDI ---

// --- API UÇ NOKTALARI BİTİYOR ---

// Sunucuyu dinlemeye başla
app.listen(PORT, () => {
    console.log(`HSS Backend Sunucusu http://localhost:${PORT} adresinde çalışıyor!`);
});