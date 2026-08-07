"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query"

export type WebSocketStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "offline"
  | "closed"
  | "error"

export interface UseWebSocketOptions<TMessage = unknown> {
  url: string | null
  enabled?: boolean
  protocols?: string | string[]
  initialRetryDelayMs?: number
  maxRetryDelayMs?: number
  maxRetries?: number
  refetchQueryKeys?: readonly QueryKey[]
  invalidateQueryKeys?: (
    message: TMessage,
  ) => readonly QueryKey[] | undefined
  parseMessage?: (event: MessageEvent<string>) => TMessage
  onMessage?: (message: TMessage) => void
  onOpen?: (event: Event) => void
  onClose?: (event: CloseEvent) => void
  onError?: (event: Event) => void
}

export interface UseWebSocketResult<TMessage> {
  status: WebSocketStatus
  lastMessage: TMessage | null
  retryCount: number
  send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => boolean
  reconnect: () => void
  close: () => void
}

export function useWebSocket<TMessage = unknown>({
  url,
  enabled = true,
  protocols,
  initialRetryDelayMs = 750,
  maxRetryDelayMs = 30_000,
  maxRetries = Number.POSITIVE_INFINITY,
  refetchQueryKeys,
  invalidateQueryKeys,
  parseMessage,
  onMessage,
  onOpen,
  onClose,
  onError,
}: UseWebSocketOptions<TMessage>): UseWebSocketResult<TMessage> {
  const queryClient = useQueryClient()
  const socketRef = useRef<WebSocket | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)
  const generationRef = useRef(0)
  const hasOpenedRef = useRef(false)
  const manualCloseRef = useRef(false)
  const callbacksRef = useRef({
    invalidateQueryKeys,
    onClose,
    onError,
    onMessage,
    onOpen,
    parseMessage,
    refetchQueryKeys,
  })
  const [status, setStatus] = useState<WebSocketStatus>("idle")
  const [lastMessage, setLastMessage] = useState<TMessage | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [reconnectKey, setReconnectKey] = useState(0)
  const protocolsKey = Array.isArray(protocols)
    ? protocols.join("\u0000")
    : protocols ?? ""

  useEffect(() => {
    callbacksRef.current = {
      invalidateQueryKeys,
      onClose,
      onError,
      onMessage,
      onOpen,
      parseMessage,
      refetchQueryKeys,
    }
  }, [
    invalidateQueryKeys,
    onClose,
    onError,
    onMessage,
    onOpen,
    parseMessage,
    refetchQueryKeys,
  ])

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  const refetchAuthoritativeData = useCallback(async () => {
    const keys = callbacksRef.current.refetchQueryKeys
    if (keys && keys.length > 0) {
      await Promise.all(
        keys.map((queryKey) =>
          queryClient.refetchQueries({ queryKey, type: "active" }),
        ),
      )
      return
    }

    await queryClient.refetchQueries({ type: "active" })
  }, [queryClient])

  const close = useCallback(() => {
    manualCloseRef.current = true
    generationRef.current += 1
    clearRetryTimer()
    socketRef.current?.close(1000, "client closed")
    socketRef.current = null
    setStatus("closed")
  }, [clearRetryTimer])

  const reconnect = useCallback(() => {
    manualCloseRef.current = false
    generationRef.current += 1
    retryCountRef.current = 0
    setRetryCount(0)
    clearRetryTimer()
    socketRef.current?.close(1000, "client reconnect")
    socketRef.current = null
    setStatus("reconnecting")
    setReconnectKey((value) => value + 1)
  }, [clearRetryTimer])

  const send = useCallback(
    (data: string | ArrayBufferLike | Blob | ArrayBufferView): boolean => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false
      }

      socket.send(data)
      return true
    },
    [],
  )

  useEffect(() => {
    if (!enabled || !url) {
      manualCloseRef.current = true
      socketRef.current?.close(1000, "disabled")
      socketRef.current = null
      clearRetryTimer()
      return
    }

    manualCloseRef.current = false
    let disposed = false
    let connectionGeneration = generationRef.current

    const scheduleReconnect = () => {
      if (disposed || manualCloseRef.current) {
        return
      }

      if (!navigator.onLine) {
        setStatus("offline")
        return
      }

      const attempt = retryCountRef.current + 1
      if (attempt > maxRetries) {
        setStatus("closed")
        return
      }

      retryCountRef.current = attempt
      setRetryCount(attempt)
      setStatus("reconnecting")

      const exponentialDelay = Math.min(
        maxRetryDelayMs,
        initialRetryDelayMs * 2 ** Math.min(attempt - 1, 10),
      )
      const jitteredDelay = exponentialDelay * (0.75 + Math.random() * 0.5)
      clearRetryTimer()
      retryTimerRef.current = setTimeout(connect, jitteredDelay)
    }

    const connect = () => {
      if (disposed || manualCloseRef.current || !navigator.onLine) {
        if (!navigator.onLine) {
          setStatus("offline")
        }
        return
      }

      clearRetryTimer()
      connectionGeneration = ++generationRef.current
      setStatus(retryCountRef.current > 0 ? "reconnecting" : "connecting")

      let socket: WebSocket
      try {
        const resolvedUrl = resolveWebSocketUrl(url)
        const resolvedProtocols = protocolsKey
          ? protocolsKey.split("\u0000")
          : undefined
        socket = new WebSocket(resolvedUrl, resolvedProtocols)
      } catch {
        setStatus("error")
        scheduleReconnect()
        return
      }

      socketRef.current = socket

      socket.onopen = (event) => {
        if (disposed || connectionGeneration !== generationRef.current) {
          socket.close(1000, "stale connection")
          return
        }

        const isReconnect = hasOpenedRef.current
        hasOpenedRef.current = true
        retryCountRef.current = 0
        setRetryCount(0)
        setStatus("open")
        callbacksRef.current.onOpen?.(event)

        if (isReconnect) {
          void refetchAuthoritativeData()
        }
      }

      socket.onmessage = (event: MessageEvent<string>) => {
        let message: TMessage
        try {
          message = callbacksRef.current.parseMessage
            ? callbacksRef.current.parseMessage(event)
            : (JSON.parse(event.data) as TMessage)
        } catch {
          return
        }

        setLastMessage(message)
        callbacksRef.current.onMessage?.(message)

        const keys = callbacksRef.current.invalidateQueryKeys?.(message)
        if (keys) {
          for (const queryKey of keys) {
            void queryClient.invalidateQueries({ queryKey })
          }
        }
      }

      socket.onerror = (event) => {
        setStatus("error")
        callbacksRef.current.onError?.(event)
      }

      socket.onclose = (event) => {
        if (socketRef.current === socket) {
          socketRef.current = null
        }
        callbacksRef.current.onClose?.(event)

        if (
          disposed ||
          manualCloseRef.current ||
          connectionGeneration !== generationRef.current
        ) {
          return
        }

        scheduleReconnect()
      }
    }

    const handleOnline = () => {
      if (!socketRef.current && !manualCloseRef.current) {
        retryCountRef.current = 0
        setRetryCount(0)
        connect()
      }
    }
    const handleOffline = () => {
      clearRetryTimer()
      setStatus("offline")
      socketRef.current?.close(1001, "browser offline")
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    connect()

    return () => {
      disposed = true
      manualCloseRef.current = true
      generationRef.current += 1
      clearRetryTimer()
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      socketRef.current?.close(1000, "component unmounted")
      socketRef.current = null
    }
  }, [
    clearRetryTimer,
    enabled,
    initialRetryDelayMs,
    maxRetries,
    maxRetryDelayMs,
    protocolsKey,
    queryClient,
    reconnectKey,
    refetchAuthoritativeData,
    url,
  ])

  return {
    status: enabled && url ? status : "idle",
    lastMessage,
    retryCount,
    send,
    reconnect,
    close,
  }
}

function resolveWebSocketUrl(url: string): string {
  if (url.startsWith("ws://") || url.startsWith("wss://")) {
    return url
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    const parsed = new URL(url)
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:"
    return parsed.toString()
  }

  const parsed = new URL(url.startsWith("/") ? url : `/${url}`, window.location.origin)
  parsed.protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return parsed.toString()
}
