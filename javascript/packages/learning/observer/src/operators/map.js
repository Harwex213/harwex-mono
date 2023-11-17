const map = (mapValueFunc) => {
    return (sourceObservable) => (subscriber) => {
        sourceObservable.subscribe({
            next: (value) => subscriber.next(mapValueFunc(value)),
            complete: () => subscriber.complete(),
            error: (err) => subscriber.error(err),
        })
    }
}

export { map }