from scsession import SaltcornSession
import socketio
import logging
import random
logging.basicConfig(
  level=logging.INFO,
  format='[%(asctime)s] %(levelname)s - %(message)s',
  datefmt='%Y-%m-%d %H:%M:%S'
)

logger = logging.getLogger(__name__)

class DynamicUpdatesClient:
  def __init__(self):
    self.session = SaltcornSession(port=3001, open_process=False)
    self.updates = []
    self.page_load_tag = format(random.randint(0, 0xFFFFFF), 'x')
    sio = socketio.Client()
    sio.on('dynamic_update', self.handle_update_event)
    self.sio = sio
    self.init_csrf()

  def handle_update_event(self, data):
    logger.info("handle_event")
    self.updates.append(data)

  def init_csrf(self):
    self.session.get('/auth/login')
    self.csrf = self.session.csrf()

  def login(self, email, password):
    self.session.postForm('/auth/login', 
      {'email': email, 
        'password': password, 
        '_csrf': self.csrf
      })
    assert self.session.redirect_url == '/'

  def connect(self):
    auth_headers = 'connect.sid=' + self.session.sessionID() + '; loggedin=true'
    self.sio.connect('http://localhost:3001',
      transports= ["websocket"], headers={'cookie': auth_headers})

  def connect_as_public(self):
    auth_headers = 'connect.sid=' + self.session.sessionID()
    self.sio.connect('http://localhost:3001',
      transports= ["websocket"], headers={'cookie': auth_headers})

  def join_dynamic_updates_room(self):
    self.sio.emit("join_dynamic_update_room", {"page_load_tag": self.page_load_tag})

  def run_trigger(self, name, page_load_tag=None):
    headers = {'page-load-tag': page_load_tag} if page_load_tag else {}
    self.session.apiPost(f'/api/action/{name}', {}, extra_headers=headers)
