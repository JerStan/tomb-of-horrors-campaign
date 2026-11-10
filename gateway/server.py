#!/usr/bin/env python3
"""GameVault: loopback-only Codex app-server adapter + SQLite authoritative save."""
import hmac,json,os,queue,re,sqlite3,subprocess,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
ROOT=Path(__file__).resolve().parent
DB=Path(os.environ.get("GAMEVAULT_DB",ROOT/"gamevault.sqlite3"))
TOKEN=os.environ.get("GAMEVAULT_ACCESS_TOKEN","")
ORIGIN="https://jerstan.github.io"
CAMPAIGN="tomb-of-horrors-seraphina"
LOCK=threading.RLock()
def connect():
 c=sqlite3.connect(DB,timeout=30);c.row_factory=sqlite3.Row;c.execute("PRAGMA journal_mode=WAL");return c
def initdb():
 DB.parent.mkdir(parents=True,exist_ok=True)
 with connect() as c:
  c.execute("CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, state TEXT NOT NULL, thread_id TEXT, revision INTEGER DEFAULT 0)")
  c.execute("CREATE TABLE IF NOT EXISTS turns(campaign TEXT, request_id TEXT, action TEXT, result TEXT, PRIMARY KEY(campaign,request_id))")
  c.execute("CREATE TABLE IF NOT EXISTS checkpoints(campaign TEXT, revision INTEGER, state TEXT, PRIMARY KEY(campaign,revision))")
  if not c.execute("SELECT 1 FROM campaigns WHERE id=?",(CAMPAIGN,)).fetchone():
   seed=(ROOT.parent/"campaign-memory.json").read_text(encoding="utf8")
   c.execute("INSERT INTO campaigns(id,state) VALUES(?,?)",(CAMPAIGN,seed))
class Codex:
 def __init__(self):self.p=None;self.seq=0;self.pending={};self.events=queue.Queue();self.write_lock=threading.Lock()
 def run(self):
  if self.p is not None and self.p.poll() is None:return
  self.p=subprocess.Popen([os.environ.get("GAMEVAULT_CODEX_BIN","codex"),"app-server","--stdio"],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1,cwd=ROOT)
  self.pending={};self.events=queue.Queue()
  threading.Thread(target=self.read,daemon=True).start()
  self.rpc("initialize",{"clientInfo":{"name":"gamevault","title":"GameVault","version":"1.0"}},30)
  self.send({"method":"initialized","params":{}})
 def read(self):
  for line in self.p.stdout:
   try:m=json.loads(line)
   except ValueError:continue
   if "id" in m:
    q=self.pending.get(str(m["id"]))
    if q:q.put(m)
   elif "method" in m:self.events.put(m)
  for q in tuple(self.pending.values()):q.put({"error":{"message":"App server disconnected"}})
 def send(self,m):
  with self.write_lock:
   if self.p.poll() is not None:raise RuntimeError("Codex not running")
   self.p.stdin.write(json.dumps(m,ensure_ascii=False)+"\n");self.p.stdin.flush()
 def rpc(self,method,params,timeout=45):
  self.seq+=1;rid=self.seq;q=queue.Queue(maxsize=1);self.pending[str(rid)]=q
  try:
   self.send({"id":rid,"method":method,"params":params})
   try:m=q.get(timeout=timeout)
   except queue.Empty:raise TimeoutError("Codex timeout: "+method)
   if "error" in m:raise RuntimeError(str(m["error"]))
   return m.get("result",{})
  finally:self.pending.pop(str(rid),None)
 def thread(self,c,row):
  if row["thread_id"]:
   self.rpc("thread/resume",{"threadId":row["thread_id"]},30)
   return row["thread_id"]
  params={"cwd":str(ROOT),"approvalPolicy":"never","sandbox":"read-only"}
  if os.environ.get("GAMEVAULT_CODEX_MODEL"):params["model"]=os.environ["GAMEVAULT_CODEX_MODEL"]
  t=self.rpc("thread/start",params,60).get("thread",{}).get("id")
  if not t:raise RuntimeError("Codex did not return thread id")
  c.execute("UPDATE campaigns SET thread_id=? WHERE id=?",(t,CAMPAIGN));c.commit()
  return t
 def turn(self,thread_id,prompt):
  while not self.events.empty():
   try:self.events.get_nowait()
   except queue.Empty:break
  ans=self.rpc("turn/start",{"threadId":thread_id,"input":[{"type":"text","text":prompt}]},60)
  turn_id=ans.get("turn",{}).get("id")
  if not turn_id:raise RuntimeError("Codex did not return turn id")
  messages=[]
  deadline=time.monotonic()+160
  while time.monotonic()<deadline:
   try:e=self.events.get(timeout=2)
   except queue.Empty:continue
   method=e.get("method");p=e.get("params") or {}
   if method=="item/completed" and p.get("turnId")==turn_id:
    item=p.get("item") or {}
    if item.get("type")=="agentMessage" and item.get("text"):messages.append(item["text"])
   if method=="turn/completed" and (p.get("turn",{}).get("id")==turn_id or p.get("turnId")==turn_id):
    if p.get("turn",{}).get("status") not in (None,"completed"):raise RuntimeError("Codex turn not completed")
    if not messages:raise RuntimeError("Codex gave no final narration")
    return messages[-1]
  raise TimeoutError("Codex turn timed out; do not retry blindly")
codex=Codex()
INSTRUCTIONS="""You are the Dungeon Master of a solo Tomb of Horrors campaign for Seraphina Vale.
Treat the provided SQLite state as authoritative. Never overwrite, redraw, or reveal unexplored map regions.
Be concise, atmospheric and faithful to prior history. Do not use tools or edit files.
Return ONLY a JSON object with keys: response (narration string), location (string),
objective (string), condition (string), newClues (string array), newExploredAreas (string array),
inventory (complete string array). Use unchanged state for unchanged fields.
"""
def game_turn(req):
 if req.get("campaignId")!=CAMPAIGN:raise ValueError("Unknown campaign")
 action=req.get("action");rid=req.get("clientTurnId")
 if not isinstance(action,str) or not 1<=len(action.strip())<=3000:raise ValueError("Invalid action")
 if not isinstance(rid,str) or not re.fullmatch(r"[a-zA-Z0-9_-]{8,128}",rid):raise ValueError("Invalid turn ID")
 with LOCK,connect() as c:
  old=c.execute("SELECT action,result FROM turns WHERE campaign=? AND request_id=?",(CAMPAIGN,rid)).fetchone()
  if old:
   if old["action"]!=action:raise ValueError("Turn ID reused")
   return json.loads(old["result"])
  row=c.execute("SELECT * FROM campaigns WHERE id=?",(CAMPAIGN,)).fetchone()
  state=json.loads(row["state"])
  codex.run();thread=codex.thread(c,row)
  raw=codex.turn(thread,INSTRUCTIONS+"\nSTATE: "+json.dumps(state,ensure_ascii=False,separators=(",",":"))+"\nACTION: "+action)
  try:out=json.loads(raw.strip())
  except ValueError:raise RuntimeError("Codex narration is not valid JSON; no state committed")
  if not isinstance(out,dict) or not isinstance(out.get("response"),str):raise RuntimeError("Invalid Codex narration")
  for source,dest in (("location","location"),("objective","objective"),("condition","status")):
   if isinstance(out.get(source),str) and out[source]:state[dest]=out[source][:1000]
  new_clues=[]
  for source,dest in (("newClues","clues"),("newExploredAreas","exploredAreas")):
   for v in out.get(source,[]):
    if isinstance(v,str) and v and v not in state.get(dest,[]):
     state.setdefault(dest,[]).append(v[:1000])
     if source=="newClues":new_clues.append(v[:1000])
  if isinstance(out.get("inventory"),list) and all(isinstance(x,str) for x in out["inventory"]):state["inventory"]=out["inventory"][:100]
  state.setdefault("journal",[]).extend(["Player: "+action,"Dungeon Master: "+out["response"]])
  state["updatedAt"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
  rev=row["revision"]+1
  result={"response":out["response"],"turnId":rev,"saveBackend":"sqlite","state":{"location":state.get("location"),"objective":state.get("objective"),"newClues":new_clues}}
  with c:
   c.execute("INSERT INTO turns VALUES(?,?,?,?)",(CAMPAIGN,rid,action,json.dumps(result,ensure_ascii=False)))
   c.execute("UPDATE campaigns SET state=?,revision=? WHERE id=?",(json.dumps(state,ensure_ascii=False),rev,CAMPAIGN))
   if rev%10==0:c.execute("INSERT INTO checkpoints VALUES(?,?,?)",(CAMPAIGN,rev,json.dumps(state,ensure_ascii=False)))
  return result
class Handler(BaseHTTPRequestHandler):
 def reply(self,status,obj):
  b=json.dumps(obj).encode()
  self.send_response(status)
  for k,v in {"Content-Type":"application/json; charset=utf-8","Content-Length":str(len(b)),"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store","Vary":"Origin"}.items():self.send_header(k,v)
  self.end_headers();self.wfile.write(b)
 def do_OPTIONS(self):
  self.reply(200 if self.headers.get("Origin")==ORIGIN else 403,{})
 def do_POST(self):
  if self.headers.get("Origin")!=ORIGIN:return self.reply(403,{"error":"Forbidden origin"})
  if not TOKEN or not hmac.compare_digest(self.headers.get("Authorization",""),"Bearer "+TOKEN):return self.reply(401,{"error":"Authentication required"})
  try:
   n=int(self.headers.get("Content-Length","0"))
   if not 1<=n<=16000:return self.reply(413,{"error":"Invalid request size"})
   data=json.loads(self.rfile.read(n))
   if self.path=="/v1/game/status":
    with LOCK,connect() as c:row=c.execute("SELECT * FROM campaigns WHERE id=?",(CAMPAIGN,)).fetchone()
    alive=codex.p is not None and codex.p.poll() is None
    return self.reply(200,{"status":"ready" if alive else "not_started","session":row["thread_id"] or "not_started","persistentSession":alive,"saveBackend":"sqlite","checkpointVersion":row["revision"]})
   if self.path=="/v1/game/turn":return self.reply(200,game_turn(data))
   self.reply(404,{"error":"No such route"})
  except ValueError as e:self.reply(400,{"error":str(e)})
  except Exception as e:
   print("Backend error:",repr(e),flush=True)
   self.reply(503,{"error":"Backend unavailable; inspect server logs before retry"})
if __name__=="__main__":
 if len(TOKEN)<32:raise SystemExit("GAMEVAULT_ACCESS_TOKEN must contain at least 32 random characters")
 initdb()
 print("GameVault gateway at localhost:8765; TLS reverse proxy required.",flush=True)
 ThreadingHTTPServer(("127.0.0.1",int(os.environ.get("GAMEVAULT_PORT","8765"))),Handler).serve_forever()
