package desi.creative.vitals

import java.math.BigInteger
import java.security.MessageDigest

/**
 * Ed25519 signature verification (RFC 8032 §5.1.7), verify only. The platform has Ed25519 only from Android 13 on and
 * the app starts at Android 8, so this is a plain port of the RFC's reference code on BigInteger: slow by crypto
 * standards (a few milliseconds), which is nothing for one check per downloaded web bundle. Strict: a non-canonical
 * point or an S at or above the group order is rejected.
 */
object Ed25519 {
    // BigInteger.TWO is Android 13+.
    private val TWO: BigInteger = BigInteger.valueOf(2)
    private val P: BigInteger = TWO.pow(255).subtract(BigInteger.valueOf(19))
    private val L: BigInteger = TWO.pow(252).add(BigInteger("27742317777372353535851937790883648493"))
    private val D: BigInteger = BigInteger.valueOf(-121665).multiply(BigInteger.valueOf(121666).modInverse(P)).mod(P)
    private val SQRT_M1: BigInteger = TWO.modPow(P.subtract(BigInteger.ONE).shiftRight(2), P)
    private val TWO_D: BigInteger = D.shiftLeft(1).mod(P)

    /** A point in extended coordinates (X:Y:Z:T), x = X/Z, y = Y/Z, xy = T/Z. */
    private class Point(val x: BigInteger, val y: BigInteger, val z: BigInteger, val t: BigInteger)

    private val NEUTRAL = Point(BigInteger.ZERO, BigInteger.ONE, BigInteger.ONE, BigInteger.ZERO)
    private val BASE: Point = run {
        val y = BigInteger.valueOf(4).multiply(BigInteger.valueOf(5).modInverse(P)).mod(P)
        val x = recoverX(y, 0)!!
        Point(x, y, BigInteger.ONE, x.multiply(y).mod(P))
    }

    fun verify(publicKey: ByteArray, message: ByteArray, signature: ByteArray): Boolean {
        if (publicKey.size != 32 || signature.size != 64) return false
        val a = decode(publicKey) ?: return false
        val rBytes = signature.copyOfRange(0, 32)
        val r = decode(rBytes) ?: return false
        val s = littleEndian(signature.copyOfRange(32, 64))
        if (s >= L) return false
        val sha = MessageDigest.getInstance("SHA-512")
        sha.update(rBytes)
        sha.update(publicKey)
        sha.update(message)
        val k = littleEndian(sha.digest()).mod(L)
        val left = mul(s, BASE)
        val right = add(r, mul(k, a))
        return equal(left, right)
    }

    private fun add(p: Point, q: Point): Point {
        val a = p.y.subtract(p.x).multiply(q.y.subtract(q.x)).mod(P)
        val b = p.y.add(p.x).multiply(q.y.add(q.x)).mod(P)
        val c = TWO_D.multiply(p.t).multiply(q.t).mod(P)
        val d = p.z.shiftLeft(1).multiply(q.z).mod(P)
        val e = b.subtract(a)
        val f = d.subtract(c)
        val g = d.add(c)
        val h = b.add(a)
        return Point(e.multiply(f).mod(P), g.multiply(h).mod(P), f.multiply(g).mod(P), e.multiply(h).mod(P))
    }

    private fun mul(scalar: BigInteger, point: Point): Point {
        var q = NEUTRAL
        var p = point
        var s = scalar
        while (s.signum() > 0) {
            if (s.testBit(0)) q = add(q, p)
            p = add(p, p)
            s = s.shiftRight(1)
        }
        return q
    }

    private fun equal(p: Point, q: Point): Boolean =
        p.x.multiply(q.z).subtract(q.x.multiply(p.z)).mod(P).signum() == 0 &&
            p.y.multiply(q.z).subtract(q.y.multiply(p.z)).mod(P).signum() == 0

    private fun recoverX(y: BigInteger, sign: Int): BigInteger? {
        if (y >= P) return null
        val y2 = y.multiply(y).mod(P)
        val u = y2.subtract(BigInteger.ONE).mod(P)
        val v = D.multiply(y2).add(BigInteger.ONE).mod(P)
        val x2 = u.multiply(v.modInverse(P)).mod(P)
        if (x2.signum() == 0) return if (sign == 0) BigInteger.ZERO else null
        var x = x2.modPow(P.add(BigInteger.valueOf(3)).shiftRight(3), P)
        if (x.multiply(x).subtract(x2).mod(P).signum() != 0) x = x.multiply(SQRT_M1).mod(P)
        if (x.multiply(x).subtract(x2).mod(P).signum() != 0) return null
        if (x.testBit(0) != (sign == 1)) x = P.subtract(x)
        return x
    }

    private fun decode(bytes: ByteArray): Point? {
        val n = littleEndian(bytes)
        val sign = if (n.testBit(255)) 1 else 0
        val y = n.clearBit(255)
        val x = recoverX(y, sign) ?: return null
        return Point(x, y, BigInteger.ONE, x.multiply(y).mod(P))
    }

    private fun littleEndian(bytes: ByteArray): BigInteger = BigInteger(1, bytes.reversedArray())
}
