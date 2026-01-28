let active = null;
const replyInput = document.getElementById("replyInput");
const messagesBox = document.getElementById("messages");

// 1. LOAD CHATS (With Styling)
async function loadChats() {
  try {
    const r = await fetch("/chats");
    const chats = await r.json();
    const list = document.getElementById("chatList");
    
    // Note: Hum list clear kar rahe hain. Real app me diffing use hoti hai, 
    // par abhi ke liye ye simple aur sahi hai.
    list.innerHTML = "";
    
    chats.forEach(c => {
      const d = document.createElement("div");
      
      // Tailwind styling for Contact List Item
      d.className = "p-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer flex items-center gap-3 transition";
      
      // HTML inside the list item (Icon + Number)
      d.innerHTML = `
        <div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 shrink-0">
          <i class="fa-solid fa-user"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-gray-700 truncate text-sm">${c._id}</div>
          <div class="text-xs text-gray-400 truncate">Click to open chat</div>
        </div>
      `;

      d.onclick = () => openChat(c._id);
      list.appendChild(d);
    });
  } catch(e) { console.error(e); }
}

// 2. OPEN CHAT (With Green Bubbles & Mobile Logic)
async function openChat(n) {
  active = n;
  
  // Mobile Fix: Agar screen choti hai, toh chat open karte hi sidebar chupa do
  if (window.innerWidth < 768) {
    document.getElementById('sidebarContainer').style.display = 'none';
    document.getElementById('toggleIcon').classList.replace('fa-expand', 'fa-compress');
    // Global variable from HTML (agar define kiya hai toh)
    if (typeof isFullScreen !== 'undefined') isFullScreen = true;
  }

  messagesBox.innerHTML = '<div class="text-center text-xs text-gray-400 mt-4">Loading...</div>';

  try {
    const r = await fetch("/messages/" + n);
    const msgs = await r.json();
    
    messagesBox.innerHTML = ""; // Clear loading

    msgs.forEach(m => {
      const d = document.createElement("div");
      
      d.innerText = m.text || "[media]";
      
      // --- LOGIC FOR GREEN BUBBLES ---
      // Agar database me direction 'outbound' ya 'sent' hai, toh 'sent' class lagao
      // CSS handle karegi Green color aur Right alignment.
      const dir = (m.direction || "").toLowerCase();
      if (dir === 'outbound' || dir === 'sent' || dir === 'out') {
        d.className = "sent"; 
      } else {
        d.className = ""; // Default White (Inbound)
      }
      
      messagesBox.appendChild(d);
    });

    scrollToBottom();

  } catch(e) { console.error(e); }
}

// 3. SEND REPLY (Instant Update)
async function sendReply() {
  const t = replyInput.value;
  if (!t || !active) return;

  // 1. Optimistic UI: Server response ka wait mat karo, turant dikha do
  const d = document.createElement("div");
  d.innerText = t;
  d.className = "sent"; // Turant Green bubble
  messagesBox.appendChild(d);
  scrollToBottom();

  replyInput.value = ""; // Input clear

  // 2. Server ko bhejo
  try {
    await fetch("/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: active, message: t })
    });
    // Hum dubara openChat call nahi karenge taaki screen flicker na kare
  } catch(e) {
    alert("Error sending message");
    d.style.opacity = "0.5"; // Error aane par message fade kar do
  }
}

function scrollToBottom() {
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

// Initial Load
loadChats();

// Auto-refresh contact list every 5 seconds (Optional: Isse scroll issue ho sakta hai)
// Agar aapko lagta hai list hil rahi hai, toh ise hata dein.
setInterval(loadChats, 5000);
