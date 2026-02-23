"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { messagesApi, usersApi } from "../../../../lib/api";
import { useWebSocket } from "../../../../hooks/useWebSocket";
import { useAuth } from "../../../../hooks/useAuth";
import { Send, Megaphone, Users, User, Plus, X, MessageSquare, ArrowLeft } from "lucide-react";

interface MessageWithSender {
  id: string;
  sender_id: string;
  sender_first_name: string;
  sender_last_name: string;
  message_type: "broadcast" | "group" | "individual";
  group_id: string | null;
  recipient_id: string | null;
  content: string;
  is_read: boolean;
  created_at: string;
}

interface ConversationItem {
  kind: "broadcast" | "group" | "individual";
  id: string | null;
  name: string;
  color: string | null;
  last_message: string | null;
  last_at: string | null;
  unread_count: number;
}

type ActiveThread =
  | { kind: "broadcast" }
  | { kind: "group"; id: string }
  | { kind: "individual"; id: string };

function threadKey(thread: ActiveThread | null): string {
  if (!thread) return "";
  if (thread.kind === "broadcast") return "broadcast";
  return `${thread.kind}-${thread.id}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}

export default function MessagesPage() {
  const t = useTranslations("messages");
  const { user } = useAuth();
  const [activeThread, setActiveThread] = useState<ActiveThread | null>(null);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [showParentModal, setShowParentModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isParent = user?.role === "parent";
  const isStaff =
    user?.role === "admin_garderie" ||
    user?.role === "educateur" ||
    user?.role === "super_admin";

  // Conversations list
  const {
    data: conversationsData,
    mutate: refreshConversations,
  } = useSWR("conversations", () =>
    messagesApi.getConversations().then((r) => r.data as ConversationItem[])
  );
  const conversations: ConversationItem[] = conversationsData ?? [];

  // Active thread messages
  const activeKey = activeThread ? `thread-${threadKey(activeThread)}` : null;
  const { data: threadData, mutate: refreshThread } = useSWR(
    activeKey,
    () => {
      if (!activeThread) return [];
      if (activeThread.kind === "broadcast")
        return messagesApi.getBroadcastThread().then((r) => r.data as MessageWithSender[]);
      if (activeThread.kind === "group")
        return messagesApi.getGroupThread(activeThread.id).then((r) => r.data as MessageWithSender[]);
      return messagesApi.getIndividualThread(activeThread.id).then((r) => r.data as MessageWithSender[]);
    }
  );
  const messages: MessageWithSender[] = threadData ?? [];

  // Users list (for new conversation modal — admin only)
  const { data: usersData } = useSWR(
    isStaff && showParentModal ? "users-for-conv" : null,
    () => usersApi.list().then((r) => r.data as { id: string; first_name: string; last_name: string; role: string; is_active: boolean }[])
  );
  const parentUsers = (usersData ?? []).filter((u) => u.role === "parent" && u.is_active);

  // Mark thread as read when opening a conversation
  useEffect(() => {
    if (!activeThread) return;
    const id =
      activeThread.kind === "broadcast" ? null :
      activeThread.kind === "group" ? activeThread.id :
      activeThread.id; // individual
    messagesApi.markThreadRead(activeThread.kind, id)
      .then(() => refreshConversations())
      .catch(() => {}); // best-effort
  }, [activeThread]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Real-time WebSocket
  const handleWsMessage = useCallback(
    (data: unknown) => {
      const msg = data as { type: string };
      if (msg?.type === "new_message") {
        refreshThread();
        refreshConversations();
      }
    },
    [refreshThread, refreshConversations]
  );
  useWebSocket(handleWsMessage);

  const sendMessage = async () => {
    if (!newMsg.trim() || !activeThread) return;
    setSending(true);
    try {
      if (activeThread.kind === "broadcast") {
        await messagesApi.send({ message_type: "broadcast", content: newMsg });
      } else if (activeThread.kind === "group") {
        await messagesApi.send({
          message_type: "group",
          group_id: activeThread.id,
          content: newMsg,
        });
      } else {
        // individual
        if (isParent) {
          // Parent → admin: no recipient_id
          await messagesApi.send({ message_type: "individual", content: newMsg });
        } else {
          // Admin → parent
          await messagesApi.send({
            message_type: "individual",
            recipient_id: activeThread.id,
            content: newMsg,
          });
        }
      }
      setNewMsg("");
      refreshThread();
      refreshConversations();
    } finally {
      setSending(false);
    }
  };

  const canWrite = (() => {
    if (!activeThread) return false;
    if (isParent && activeThread.kind === "broadcast") return false;
    return true;
  })();

  const startConversation = (parentId: string, parentName: string) => {
    setShowParentModal(false);
    setActiveThread({ kind: "individual", id: parentId });
    // Add to conversations list if not already there
    refreshConversations();
  };

  const groups = conversations.filter((c) => c.kind === "group");
  const individuals = conversations.filter((c) => c.kind === "individual");
  const broadcastItem = conversations.find((c) => c.kind === "broadcast");

  const activeConv = conversations.find((c) => {
    if (!activeThread) return false;
    if (activeThread.kind === "broadcast") return c.kind === "broadcast";
    if (activeThread.kind === "group") return c.kind === "group" && c.id === activeThread.id;
    return c.kind === "individual" && c.id === activeThread.id;
  });

  const activeConvName = (() => {
    if (!activeThread) return "";
    if (activeConv) return activeConv.name;
    return "";
  })();

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar — full width on mobile when no thread selected, fixed width on desktop */}
      <div className={`${activeThread ? "hidden" : "flex"} md:flex w-full md:w-72 border-r border-slate-200 bg-white flex-col flex-shrink-0`}>
        <div className="px-4 py-4 border-b border-slate-100">
          <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {/* Broadcast */}
          {broadcastItem && (
            <SidebarItem
              item={broadcastItem}
              isActive={activeThread?.kind === "broadcast"}
              onClick={() => setActiveThread({ kind: "broadcast" })}
              icon={<Megaphone className="w-4 h-4 text-slate-500" />}
            />
          )}

          {/* Groups section */}
          {groups.length > 0 && (
            <>
              <div className="px-4 pt-4 pb-1">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  {t("groupsSection")}
                </span>
              </div>
              {groups.map((item) => (
                <SidebarItem
                  key={item.id}
                  item={item}
                  isActive={activeThread?.kind === "group" && activeThread.id === item.id}
                  onClick={() => setActiveThread({ kind: "group", id: item.id! })}
                  icon={<Users className="w-4 h-4 text-slate-500" />}
                />
              ))}
            </>
          )}

          {/* Individual conversations section */}
          <div className="px-4 pt-4 pb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {t("directSection")}
            </span>
            {isStaff && (
              <button
                onClick={() => setShowParentModal(true)}
                className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
                title={t("newConversation")}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {individuals.map((item) => (
            <SidebarItem
              key={item.id}
              item={item}
              isActive={activeThread?.kind === "individual" && activeThread.id === item.id}
              onClick={() => setActiveThread({ kind: "individual", id: item.id! })}
              icon={<User className="w-4 h-4 text-slate-500" />}
            />
          ))}
          {individuals.length === 0 && isParent && (
            <p className="px-4 py-2 text-xs text-slate-400">{t("garderie")}</p>
          )}
        </div>
      </div>

      {/* Chat panel — hidden on mobile when no thread selected */}
      <div className={`${activeThread ? "flex" : "hidden"} md:flex flex-1 flex-col min-w-0`}>
        {activeThread ? (
          <>
            {/* Header */}
            <div className="px-4 md:px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3">
              {/* Back button — mobile only */}
              <button
                onClick={() => setActiveThread(null)}
                className="md:hidden p-1.5 -ml-1 text-slate-500 hover:bg-slate-100 rounded-lg flex-shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              {activeThread.kind === "broadcast" && <Megaphone className="w-5 h-5 text-blue-600" />}
              {activeThread.kind === "group" && (
                <div
                  className="w-5 h-5 rounded-full border border-slate-300 flex-shrink-0"
                  style={{ backgroundColor: activeConv?.color ?? "#94a3b8" }}
                />
              )}
              {activeThread.kind === "individual" && <User className="w-5 h-5 text-slate-500 flex-shrink-0" />}
              <span className="font-semibold text-slate-800 truncate">{activeConvName}</span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
              {messages.length === 0 ? (
                <p className="text-center text-slate-400 mt-16 text-sm">{t("noMessages")}</p>
              ) : (
                messages.map((msg) => {
                  const isMine = msg.sender_id === user?.id;
                  return (
                    <MessageBubble key={msg.id} msg={msg} isMine={isMine} tYou={t("you")} />
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input bar */}
            {canWrite ? (
              <div className="p-4 bg-white border-t border-slate-200">
                <div className="flex gap-3 items-end">
                  <textarea
                    value={newMsg}
                    onChange={(e) => setNewMsg(e.target.value)}
                    placeholder={t("placeholder")}
                    rows={1}
                    className="flex-1 px-4 py-3 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sending || !newMsg.trim()}
                    className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition flex-shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-white border-t border-slate-200">
                <div className="flex items-center justify-center gap-2 py-2 px-4 bg-slate-100 rounded-xl text-sm text-slate-500">
                  <MessageSquare className="w-4 h-4" />
                  {t("readOnly")}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center flex-col gap-3 text-slate-400">
            <MessageSquare className="w-12 h-12 opacity-30" />
            <p className="text-sm">{t("selectConversation")}</p>
          </div>
        )}
      </div>

      {/* Modal nouvelle conversation (admin) */}
      {showParentModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800">{t("newConversation")}</h2>
              <button
                onClick={() => setShowParentModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto">
              {parentUsers.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">{t("chooseParent")}</p>
              ) : (
                <div className="space-y-1">
                  {parentUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => startConversation(u.id, `${u.first_name} ${u.last_name}`)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 text-left transition"
                    >
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-medium text-sm flex-shrink-0">
                        {u.first_name[0]}{u.last_name[0]}
                      </div>
                      <span className="text-sm text-slate-700">
                        {u.first_name} {u.last_name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarItem({
  item,
  isActive,
  onClick,
  icon,
}: {
  item: ConversationItem;
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition border-l-2 ${
        isActive
          ? "bg-blue-50 border-l-blue-600"
          : "border-l-transparent hover:bg-slate-50"
      }`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {item.kind === "group" && item.color ? (
          <div
            className="w-4 h-4 rounded-full border border-slate-300"
            style={{ backgroundColor: item.color }}
          />
        ) : (
          icon
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-sm font-medium truncate ${
              isActive ? "text-blue-700" : "text-slate-700"
            }`}
          >
            {item.name}
          </span>
          {item.unread_count > 0 && (
            <span className="flex-shrink-0 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
              {item.unread_count}
            </span>
          )}
        </div>
        {item.last_message && (
          <p className="text-xs text-slate-400 truncate mt-0.5">{item.last_message}</p>
        )}
      </div>
    </button>
  );
}

function MessageBubble({
  msg,
  isMine,
  tYou,
}: {
  msg: MessageWithSender;
  isMine: boolean;
  tYou: string;
}) {
  const senderName = isMine
    ? tYou
    : `${msg.sender_first_name} ${msg.sender_last_name}`;

  return (
    <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-lg">
        {!isMine && (
          <p className="text-xs text-slate-500 mb-1 ml-1">{senderName}</p>
        )}
        <div
          className={`px-4 py-2.5 ${
            isMine
              ? "bg-blue-600 text-white rounded-2xl rounded-br-sm"
              : "bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-sm"
          }`}
        >
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          <p
            className={`text-xs mt-1 ${
              isMine ? "text-blue-200 text-right" : "text-slate-400"
            }`}
          >
            {formatTime(msg.created_at)}
          </p>
        </div>
      </div>
    </div>
  );
}
