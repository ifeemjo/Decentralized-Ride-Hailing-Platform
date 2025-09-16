(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-PICKUP u101)
(define-constant ERR-INVALID-DESTINATION u102)
(define-constant ERR-INVALID-PRICE u103)
(define-constant ERR-INVALID-STATUS u104)
(define-constant ERR-RIDE-NOT-FOUND u105)
(define-constant ERR-RIDE-ALREADY-ACCEPTED u106)
(define-constant ERR-RIDE-NOT-PENDING u107)
(define-constant ERR-RIDE-NOT-ACCEPTED u108)
(define-constant ERR-RIDE-ALREADY-COMPLETED u109)
(define-constant ERR-INVALID-TIMESTAMP u110)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u111)
(define-constant ERR-INVALID-RIDER u112)
(define-constant ERR-INVALID-DRIVER u113)
(define-constant ERR-MAX-RIDES-EXCEEDED u114)
(define-constant ERR-INVALID-UPDATE-PARAM u115)
(define-constant ERR-RIDE-UPDATE-NOT-ALLOWED u116)
(define-constant ERR-INVALID-LOCATION u117)
(define-constant ERR-INVALID-CURRENCY u118)
(define-constant ERR-INVALID-COMPLETION u119)
(define-constant ERR-ESCROW-NOT-SET u120)

(define-data-var ride-counter uint u0)
(define-data-var max-rides uint u10000)
(define-data-var creation-fee uint u100)
(define-data-var authority-contract (optional principal) none)

(define-map rides
  uint
  {
    rider: principal,
    driver: (optional principal),
    pickup: (string-ascii 100),
    destination: (string-ascii 100),
    price: uint,
    status: (string-ascii 20),
    timestamp: uint,
    currency: (string-ascii 10),
    completion-time: (optional uint)
  }
)

(define-map rides-by-rider
  principal
  (list 100 uint)
)

(define-map rides-by-driver
  principal
  (list 100 uint)
)

(define-map ride-updates
  uint
  {
    update-pickup: (string-ascii 100),
    update-destination: (string-ascii 100),
    update-price: uint,
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-ride (id uint))
  (map-get? rides id)
)

(define-read-only (get-ride-updates (id uint))
  (map-get? ride-updates id)
)

(define-read-only (get-rides-by-rider (rider principal))
  (default-to (list) (map-get? rides-by-rider rider))
)

(define-read-only (get-rides-by-driver (driver principal))
  (default-to (list) (map-get? rides-by-driver driver))
)

(define-read-only (is-ride-registered (id uint))
  (is-some (map-get? rides id))
)

(define-private (validate-location (loc (string-ascii 100)))
  (if (and (> (len loc) u0) (<= (len loc) u100))
      (ok true)
      (err ERR-INVALID-LOCATION))
)

(define-private (validate-price (price uint))
  (if (> price u0)
      (ok true)
      (err ERR-INVALID-PRICE))
)

(define-private (validate-status (status (string-ascii 20)))
  (if (or (is-eq status "pending") (is-eq status "accepted") (is-eq status "completed") (is-eq status "cancelled"))
      (ok true)
      (err ERR-INVALID-STATUS))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-currency (cur (string-ascii 10)))
  (if (or (is-eq cur "STX") (is-eq cur "USD"))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-rides (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-MAX-RIDES-EXCEEDED))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-rides new-max)
    (ok true)
  )
)

(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)
  )
)

(define-public (register-ride
  (pickup (string-ascii 100))
  (destination (string-ascii 100))
  (price uint)
  (currency (string-ascii 10))
)
  (let (
        (next-id (+ (var-get ride-counter) u1))
        (current-max (var-get max-rides))
        (authority (var-get authority-contract))
      )
    (asserts! (< (var-get ride-counter) current-max) (err ERR-MAX-RIDES-EXCEEDED))
    (try! (validate-location pickup))
    (try! (validate-location destination))
    (try! (validate-price price))
    (try! (validate-currency currency))
    (try! (contract-call? .auth verify-user tx-sender))
    (asserts! (is-some authority) (err ERR-AUTHORITY-NOT-VERIFIED))
    (try! (stx-transfer? (var-get creation-fee) tx-sender (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
    (map-set rides next-id
      {
        rider: tx-sender,
        driver: none,
        pickup: pickup,
        destination: destination,
        price: price,
        status: "pending",
        timestamp: block-height,
        currency: currency,
        completion-time: none
      }
    )
    (map-set rides-by-rider tx-sender (cons next-id (default-to (list) (map-get? rides-by-rider tx-sender))))
    (var-set ride-counter next-id)
    (print { event: "ride-registered", id: next-id })
    (ok next-id)
  )
)

(define-public (accept-ride (ride-id uint))
  (let ((ride (map-get? rides ride-id)))
    (match ride
      r
        (begin
          (asserts! (is-eq (get status r) "pending") (err ERR-RIDE-NOT-PENDING))
          (asserts! (is-none (get driver r)) (err ERR-RIDE-ALREADY-ACCEPTED))
          (try! (contract-call? .auth verify-user tx-sender))
          (asserts! (not (is-eq (get rider r) tx-sender)) (err ERR-NOT-AUTHORIZED))
          (map-set rides ride-id
            (merge r { driver: (some tx-sender), status: "accepted" })
          )
          (map-set rides-by-driver tx-sender (cons ride-id (default-to (list) (map-get? rides-by-driver tx-sender))))
          (try! (contract-call? .escrow lock-funds ride-id (get price r) (get rider r) tx-sender))
          (print { event: "ride-accepted", id: ride-id })
          (ok true)
        )
      (err ERR-RIDE-NOT-FOUND)
    )
  )
)

(define-public (complete-ride (ride-id uint))
  (let ((ride (map-get? rides ride-id)))
    (match ride
      r
        (begin
          (asserts! (is-eq (get status r) "accepted") (err ERR-RIDE-NOT-ACCEPTED))
          (asserts! (is-eq (get rider r) tx-sender) (err ERR-NOT-AUTHORIZED))
          (asserts! (is-some (get driver r)) (err ERR-INVALID-DRIVER))
          (map-set rides ride-id
            (merge r { status: "completed", completion-time: (some block-height) })
          )
          (try! (contract-call? .escrow release-funds ride-id (unwrap! (get driver r) (err ERR-INVALID-DRIVER))))
          (try! (contract-call? .reputation update-rating ride-id tx-sender (unwrap! (get driver r) (err ERR-INVALID-DRIVER))))
          (print { event: "ride-completed", id: ride-id })
          (ok true)
        )
      (err ERR-RIDE-NOT-FOUND)
    )
  )
)

(define-public (cancel-ride (ride-id uint))
  (let ((ride (map-get? rides ride-id)))
    (match ride
      r
        (begin
          (asserts! (or (is-eq (get rider r) tx-sender) (is-eq (unwrap-panic (get driver r)) tx-sender)) (err ERR-NOT-AUTHORIZED))
          (asserts! (not (is-eq (get status r) "completed")) (err ERR-RIDE-ALREADY-COMPLETED))
          (map-set rides ride-id
            (merge r { status: "cancelled", driver: none })
          )
          (if (is-eq (get status r) "accepted")
              (try! (contract-call? .escrow refund-funds ride-id (get rider r)))
              (ok true)
          )
          (print { event: "ride-cancelled", id: ride-id })
          (ok true)
        )
      (err ERR-RIDE-NOT-FOUND)
    )
  )
)

(define-public (update-ride
  (ride-id uint)
  (update-pickup (string-ascii 100))
  (update-destination (string-ascii 100))
  (update-price uint)
)
  (let ((ride (map-get? rides ride-id)))
    (match ride
      r
        (begin
          (asserts! (is-eq (get rider r) tx-sender) (err ERR-NOT-AUTHORIZED))
          (asserts! (is-eq (get status r) "pending") (err ERR-RIDE-UPDATE-NOT-ALLOWED))
          (try! (validate-location update-pickup))
          (try! (validate-location update-destination))
          (try! (validate-price update-price))
          (map-set rides ride-id
            (merge r {
              pickup: update-pickup,
              destination: update-destination,
              price: update-price,
              timestamp: block-height
            })
          )
          (map-set ride-updates ride-id
            {
              update-pickup: update-pickup,
              update-destination: update-destination,
              update-price: update-price,
              update-timestamp: block-height,
              updater: tx-sender
            }
          )
          (print { event: "ride-updated", id: ride-id })
          (ok true)
        )
      (err ERR-RIDE-NOT-FOUND)
    )
  )
)

(define-public (get-ride-count)
  (ok (var-get ride-counter))
)