package realtime

import (
	"happyrobot/api/internal/domain"
	"sync"
)

type Broker struct {
	mu   sync.RWMutex
	next int
	subs map[int]chan domain.Event
}

func New() *Broker { return &Broker{subs: map[int]chan domain.Event{}} }

func (b *Broker) Subscribe() (int, <-chan domain.Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	id := b.next
	b.next++
	ch := make(chan domain.Event, 64)
	b.subs[id] = ch
	return id, ch
}

func (b *Broker) Unsubscribe(id int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ch, ok := b.subs[id]; ok {
		delete(b.subs, id)
		close(ch)
	}
}

func (b *Broker) Publish(evt domain.Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ch := range b.subs {
		select {
		case ch <- evt:
		default: /* slow client drops live event; replay catches up */
		}
	}
}
