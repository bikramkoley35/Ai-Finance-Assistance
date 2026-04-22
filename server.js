// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
require("dotenv").config();
const twilio = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'frontend')));

// Serve static assets
app.use('/static', express.static(path.join(__dirname, 'static')));

// In-memory sessions
const sessions = {};

// Dummy DB
const customers = {
  "8420382848": {"name":"Rahul Verma","age":31,"city":"Delhi","salary":60000,"profession":"Engineer","pre_limit":200000,"credit":780},
  "9876543210": {"name":"Rahul Verma","age":31,"city":"Delhi","salary":60000,"profession":"Engineer","pre_limit":200000,"credit":780},
  "9123456789": {"name":"Aditi Sharma","age":28,"city":"Mumbai","salary":45000,"profession":"Designer","pre_limit":150000,"credit":720},
  "9988776655": {"name":"Rohan Singh","age":35,"city":"Bangalore","salary":80000,"profession":"Manager","pre_limit":300000,"credit":810},
  "9001122334": {"name":"Sneha Patel","age":26,"city":"Pune","salary":38000,"profession":"Teacher","pre_limit":100000,"credit":690},
  "9090909090": {"name":"Aman Khan","age":30,"city":"Hyderabad","salary":50000,"profession":"Analyst","pre_limit":180000,"credit":750},
  "8888777766": {"name":"Priya Das","age":33,"city":"Kolkata","salary":72000,"profession":"Doctor","pre_limit":350000,"credit":820},
  "7777666655": {"name":"Vikas Mehta","age":29,"city":"Chennai","salary":42000,"profession":"Developer","pre_limit":140000,"credit":710},
  "9999888877": {"name":"Ananya Roy","age":27,"city":"Delhi","salary":46000,"profession":"Nurse","pre_limit":160000,"credit":735},
  "9898989898": {"name":"Karan Jain","age":36,"city":"Mumbai","salary":90000,"profession":"Architect","pre_limit":400000,"credit":840},
  "9100000001": {"name":"Megha Gupta","age":32,"city":"Noida","salary":55000,"profession":"Consultant","pre_limit":220000,"credit":765}
};

// EMI calculator
function calc_emi(p, annualRatePercent, months) {
  const r = annualRatePercent / 12 / 100;
  if (r === 0) return Math.ceil(p / months);
  return Math.ceil((p * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1));
}

// Generate sanction letter PDF
// function make_pdf(name, phone, amt, tenure, emi) {
//   const c = customers[phone];
//   const filename = `sanction_${phone}.pdf`;
//   const filepath = path.join(__dirname, filename);

//   const doc = new PDFDocument();
//   const stream = fs.createWriteStream(filepath);
//   doc.pipe(stream);

//   doc.fontSize(22).text("Loan Sanction Letter", { align: "center" });
//     doc.moveDown();

//     doc.fontSize(14).text(`Name: ${name}`);
//     doc.text(`Phone: ${phone}`);
//     doc.text(`Loan Amount Approved: ₹${amt}`);
//     doc.text(`Tenure: ${tenure} months`);
//     doc.text(`Monthly EMI: ₹${emi}`);
//   doc.moveDown(1);
//   doc.text("Thank you for choosing our Bank.", { align: "center" });
//   doc.end();
//   return filename;
// }
function make_pdf(name, phone, amt, tenure, emi) {
  const filename = `sanction_${phone}.pdf`;
  const filepath = path.join(__dirname, filename);

  const doc = new PDFDocument();
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  doc.fontSize(22).text("Loan Sanction Letter", { align: "center" });
  doc.moveDown();

  doc.fontSize(14).text(`Name: ${name}`);
  doc.text(`Phone: ${phone}`);
  doc.text(`Loan Amount Approved: ₹${amt}`);
  doc.text(`Tenure: ${tenure} months`);
  doc.text(`Monthly EMI: ₹${emi}`);
  doc.moveDown(1);
  doc.text("Thank you for choosing our Bank.", { align: "center" });

  doc.end();
  return filename;
}


// Serve UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname,'index.html'));
});

// ✅ OTP SEND Route (called automatically inside chat)
async function sendOTP(phone) {
  return twilio.verify.v2.services(process.env.TWILIO_VERIFY_SID)
    .verifications.create({ to: `+91${phone}`, channel: "sms" });
}

// ✅ OTP VERIFY Route (we call it inline in chat flow)
async function verifyOTP(phone, otp) {
  return twilio.verify.v2.services(process.env.TWILIO_VERIFY_SID)
    .verificationChecks.create({ to: `+91${phone}`, code: otp });
}

// 🚀 Chat Route
app.post('/chat', async (req, res) => {
  try {
    const data = req.body;
    const sid = data.id || uuidv4();
    const msgRaw = (data.msg || '').toLowerCase();
    const s = sessions[sid] || { step: 0 };
    let r = "";

    if (s.step === 0) {
      r = "Welcome! May I know your registered mobile number?";
      s.step = 1;

    } else if (s.step === 1) {
      const clean = msgRaw.replace(/\s+/g, '');
      if (!customers[clean]) {
        r = "This number is not in our records. Enter again.";
      } else {
        s.phone = clean;
        await sendOTP(clean);
        r = `✅ OTP sent to +91${clean}. Please enter the OTP.`;
        s.step = 100;
      }

    } else if (s.step === 100) {
      const otp = data.msg.trim();
      const result = await verifyOTP(s.phone, otp);

      if (result.status !== "approved") {
        r = "❌ Incorrect OTP. Please try again.";
      } else {
        const c = customers[s.phone];
        r = `✅ OTP Verified!\nHi ${c.name}! Which loan do you want? (personal)`;
        s.step = 2;
      }

    } else if (s.step === 2) {
      if (!msgRaw.includes("personal")) {
        r = "Currently only personal loans are supported.";
      } else {
        const c = customers[s.phone];
        r = `Great! You are pre-approved for INR ${c.pre_limit}. How much do you need?`;
        s.step = 3;
      }

    } else if (s.step === 3) {
      const amt = parseInt(data.msg.replace(/[^\d]/g, ''), 10);
      if (!amt) r = "Enter a valid amount.";
      else {
        s.loan_amount = amt;
        r = "For how many months do you want the loan?";
        s.step = 4;
      }

    } else if (s.step === 4) {
      const t = parseInt(data.msg.replace(/[^\d]/g, ''), 10);
      const c = customers[s.phone];
      const amt = s.loan_amount;

      if (c.credit < 700) {
        r = "❌ Credit score too low.";
      } else if (amt <= c.pre_limit) {
        const emi = calc_emi(amt, 12, t);
        const c = customers[s.phone];
const filename = make_pdf(c.name, s.phone, amt, t, emi);

        return res.json({ id: sid, reply: `✅ Approved! EMI: ${emi}`, link: `/${filename}` });
      } else {
        return res.json({ id: sid, reply: "📄 Please upload salary slip for verification.", link: "/kyc.html" });
      }
    }

    sessions[sid] = s;
    res.json({ id: sid, reply: r });

  } catch (err) {
    console.log(err);
    res.json({ id: null, reply: "⚠️ Server error" });
  }
});

// Serve
//const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
