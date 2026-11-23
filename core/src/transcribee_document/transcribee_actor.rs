use automerge::ActorId;

pub(crate) struct TranscribeeActor {
    actor_id: u16,
}

impl TranscribeeActor {
    fn new(actor_id: u16) -> Self {
        Self { actor_id }
    }

    fn random_actor_id(&self) -> ActorId {
        let mut actor_id = [0u8; 16];
        actor_id[0] = (self.actor_id & 0xff) as u8;
        actor_id[1] = ((self.actor_id >> 8) & 0xff) as u8;
        actor_id[2..].copy_from_slice(ActorId::random().to_bytes());
        actor_id.into()
    }

    fn is_id(&self, id: ActorId) -> bool {
        let mut other_id = 0u16;
        other_id += id.to_bytes()[0] as u16;
        other_id += (id.to_bytes()[1] as u16) << 8;

        self.actor_id == other_id
    }
}
